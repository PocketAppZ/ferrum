import { ipcRenderer } from 'electron'
import simplePlist from 'simple-plist'
import path from 'path'
import url from 'url'
import fs from 'fs'
import mm from 'music-metadata'
import * as addon from 'ferrum-addon'
import {
  Playlist as LibraryPlaylist,
  Folder as LibraryFolder,
  Track as LibraryTrack,
  TrackListsHashMap,
  SpecialTrackListName,
} from 'ferrum-addon'

type Track = LibraryTrack & {
  importedFrom: 'itunes'
  dateImported: number
  duration: number
  bitrate: number
  sampleRate: number
  name: string
  originalId: string
}

type XmlTrack = {
  'Date Modified': Date
  'Date Added': Date
  'Play Date UTC': Date
  importedFrom: 'itunes'
  Artist?: string
  Name?: string
  'Persistent ID'?: string
  Composer?: string
  'Sort Name'?: string
  'Sort Artist'?: string
  'Sort Composer'?: string
  Genre?: string
  Rating?: unknown // TODO
  Year?: unknown // TODO
  BPM?: unknown // TODO
  Comments?: string
  Grouping?: string
  'Play Count'?: unknown // TODO
  'Volume Adjustment': number
}

type TrackList = Playlist | Folder

type Playlist = LibraryPlaylist & {
  importedFrom: 'itunes'
  originalId: string
  dateImported: number
}

type Folder = LibraryFolder & {
  name: string
  description?: string
  liked?: string
  disliked?: string
  /** For example "itunes" */
  importedFrom?: string
  /** For example iTunes Persistent ID */
  originalId?: string
  dateImported?: number
  dateCreated?: number
  children: string[]
}

type Paths = {
  library_dir: string
  tracks_dir: string
  library_json: string
}

type Result = { cancelled: boolean; warnings: string[]; err?: Error }
export async function iTunesImport(
  paths: Paths,
  status: (status: string) => void,
  warn: (status: string) => void
): Promise<Result> {
  const warnings: string[] = []
  try {
    const result = await start(paths, status, (warning) => {
      warnings.push(warning)
      warn(warning)
    })
    return { ...result, warnings }
  } catch (err) {
    console.error(err)
    return { err: new Error('Unknown'), warnings, cancelled: true }
  }
}

function sanitizeFilename(str: string) {
  str = str.replaceAll('/', '_')
  str = str.replaceAll('?', '_')
  str = str.replaceAll('<', '_')
  str = str.replaceAll('>', '_')
  str = str.replaceAll('\\', '_')
  str = str.replaceAll(':', '_')
  str = str.replaceAll('*', '_')
  str = str.replaceAll('"', '_')
  // prevent control characters:
  str = str.replaceAll('0x', '__')
  // Filenames can be max 255 bytes. We use 230 to give
  // margin for the fileNum and file extension.
  return str.substring(0, 230)
}

function generateFilename(track: Track, originalPath: string, tracksDir: string): string {
  const name = track.name || ''
  const artist = track.artist || ''
  const beginning = sanitizeFilename(artist + ' - ' + name)

  const ext = path.extname(originalPath)
  const allowedExt = ['.mp3', '.m4a']
  if (!allowedExt.includes(ext)) {
    // by having an approved set of file extensions, we avoid unsafe filenames:
    //    - Unix reserved filenames `.` and `..`
    //    - Windows reserved filenames `CON`, `PRN` etc.
    //    - Trailing `.` and ` `
    throw new Error(`Unsupported file extension "${ext}"`)
  }

  let fileNum = 0
  let ending = ''

  let filename
  for (let i = 0; i < 999; i++) {
    if (i === 500) {
      break
    }
    filename = beginning + ending + ext
    const filepath = path.join(tracksDir, filename)
    if (fs.existsSync(filepath)) {
      fileNum++
      ending = ' ' + fileNum
    } else {
      return filename
    }
  }
  throw new Error('Already got 500 tracks with that artist and title')
}

function readPlist(filePath: string) {
  return new Promise((resolve, reject) => {
    simplePlist.readFile(filePath, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

function makeId(length = 10) {
  let result = ''
  const characters = 'abcdefghijklmnopqrstuvwxyz234567'
  const charactersLength = characters.length
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }
  return result
}

function buffersEqual(buf1: Buffer, buf2: Buffer) {
  return Buffer.compare(buf1, buf2) === 0
}

async function popup() {
  const m =
    'WARNING: This will reset/delete your Ferrum library!' +
    '\n' +
    '\nSelect an iTunes "Library.xml" file. To get that file, open iTunes and click on "File > Library > Export Library..."' +
    '\n' +
    '\nAll your tracks need to be downloaded for this to work.' +
    ' If you have tracks from iTunes Store/Apple Music, it might not work.' +
    '\n' +
    '\nThe following will not be imported:' +
    '\n- Music videos, podcasts, audiobooks, voice memos etc.' +
    '\n- Smart playlists, Genius playlists and Genius Mix playlists' +
    '\n- View options' +
    '\n- Album ratings, album likes and album dislikes' +
    '\n- The following track metadata:' +
    '\n    - Lyrics' +
    '\n    - Equalizer' +
    '\n    - Skip when shuffling' +
    '\n    - Remember playback position' +
    '\n    - Disc Count' +
    '\n    - Start time' +
    '\n    - Stop time'
  const info = await ipcRenderer.invoke('showMessageBox', true, {
    type: 'info',
    title: 'iTunes Import',
    message: m,
    checkboxLabel: 'Dry run',
    checkboxChecked: true,
    buttons: ['OK', 'Cancel'],
  })
  if (info.response === 1) return {}
  const dryRun = info.checkboxChecked
  const open = await ipcRenderer.invoke('showOpenDialog', true, {
    properties: ['openFile'],
  })
  if (!open.canceled && open.canceled.filePaths && open.canceled.filePaths[0]) {
    return { dryRun, filePath: open.canceled.filePaths[0] }
  }
  return {}
}

enum Info {
  Required = 1,
  Recommended = 1,
}

async function parseTrack(
  xml_track: XmlTrack,
  warn: (msg: string) => void,
  startTime: number,
  dryRun: boolean,
  paths: Paths
) {
  const track: Track = {
    importedFrom: 'itunes',
    dateImported: startTime,
  }
  const logPrefix = '[' + xml_track['Artist'] + ' - ' + xml_track['Name'] + ']'
  function addIfTruthy(prop: string, value: string | Date | undefined, info?: Info) {
    if (value instanceof Date) {
      track[prop] = value.getTime()
    } else if (value) {
      track[prop] = value
    } else if (info === Info.Required) {
      throw new Error(logPrefix + ` Track missing required field "${prop}"`)
    } else if (info === Info.Recommended) {
      warn(logPrefix + ` Missing recommended field "${prop}"`)
    }
  }
  addIfTruthy('name', xml_track['Name'], Info.Recommended)
  addIfTruthy('originalId', xml_track['Persistent ID'])
  addIfTruthy('artist', xml_track['Artist'], Info.Recommended)
  addIfTruthy('composer', xml_track['Composer'])
  addIfTruthy('sortName', xml_track['Sort Name'])
  addIfTruthy('sortArtist', xml_track['Sort Artist'])
  addIfTruthy('sortComposer', xml_track['Sort Composer'])
  addIfTruthy('genre', xml_track['Genre'])
  addIfTruthy('rating', xml_track['Rating'])
  addIfTruthy('year', xml_track['Year'])
  addIfTruthy('bpm', xml_track['BPM'])
  addIfTruthy('dateModified', xml_track['Date Modified'], Info.Required)
  addIfTruthy('dateAdded', xml_track['Date Added'], Info.Required)
  addIfTruthy('comments', xml_track['Comments'])
  addIfTruthy('grouping', xml_track['Grouping'])
  if (xml_track['Play Count'] && xml_track['Play Count'] >= 1) {
    track['playCount'] = xml_track['Play Count']
    // Unlike "Skip Date" etc, "Play Date" is a non-UTC Mac HFS+ timestamp, but
    // luckily "Play Date UTC" is a normal date.
    const playDate = xml_track['Play Date UTC']
    let imported_play_count = xml_track['Play Count']
    if (playDate !== undefined) {
      // if we have a playDate, add a play for it
      track['plays'] = [playDate.getTime()]
      imported_play_count--
    }
    if (imported_play_count >= 1) {
      track['playsImported'] = [
        {
          count: imported_play_count,
          fromDate: xml_track['Date Added'].getTime(),
          toDate: playDate === undefined ? startTime : playDate.getTime(),
        },
      ]
    }
  }
  if (xml_track['Skip Count'] && xml_track['Skip Count'] >= 1) {
    track['skipCount'] = xml_track['Skip Count']
    const skipDate = xml_track['Skip Date']
    let importedSkipCount = xml_track['Skip Count']
    if (skipDate !== undefined) {
      // if we have a skipDate, add a skip for it
      track['skips'] = [skipDate.getTime()]
      importedSkipCount--
    }
    if (importedSkipCount >= 1) {
      track['skipsImported'] = [
        {
          count: importedSkipCount,
          fromDate: xml_track['Date Added'].getTime(),
          toDate: skipDate === undefined ? startTime : skipDate.getTime(),
        },
      ]
    }
  }
  // Play Time?
  //    Probably don't calculate play time from imported plays
  // Location (use to get file and extract cover)
  if (xml_track['Volume Adjustment']) {
    // In iTunes, you can choose volume adjustment at 10% increments. The XML
    // value Seems like it should go from -255 to 255. However, when set to
    // 100%, I got 255 on one track, but 254 on another. We'll just
    // convert it to a -100 to 100 range and round off decimals.
    const vol = Math.round(xml_track['Volume Adjustment'] / 2.55)
    if (vol && vol >= -100 && vol <= 100) {
      track['volume'] = vol
    } else {
      warn(logPrefix + ` Unable to import Volume Adjustment of value "${vol}"`)
    }
  }
  addIfTruthy('liked', xml_track['Loved'])
  addIfTruthy('disliked', xml_track['Disliked'])
  addIfTruthy('disabled', xml_track['Disabled'])

  if (xml_track['Compilation']) track.compilation = true
  if (xml_track['Album']) track.albumName = xml_track['Album']
  if (xml_track['Album Artist']) track.albumArtist = xml_track['Album Artist']
  if (xml_track['Sort Album']) track.sortAlbumName = xml_track['Sort Album']
  if (xml_track['Sort Album Artist']) track.sortAlbumArtist = xml_track['Sort Album Artist']

  if (xml_track['Track Number']) track.trackNum = xml_track['Track Number']
  if (xml_track['Track Count']) track.trackCount = xml_track['Track Count']
  if (xml_track['Disc Number']) track.discNum = xml_track['Disc Number']
  if (xml_track['Disc Count']) track.discCount = xml_track['Disc Count']

  if (xml_track['Track Type'] !== 'File') {
    const trackType = xml_track['Track Type']
    throw new Error(logPrefix + ` Expected track type "File", was "${trackType}"`)
  }
  if (!xml_track['Location']) {
    throw new Error(logPrefix + ' Missing required field "Location"')
  }
  const xmlTrackPath = url.fileURLToPath(xml_track['Location'])
  if (!fs.existsSync(xmlTrackPath)) {
    throw new Error(logPrefix + ' File does not exist')
  }
  const stats = fs.statSync(xmlTrackPath)
  track.size = stats.size

  const md = await mm.parseFile(xmlTrackPath)
  // Warnings are in md.quality.warnings
  if (!md.format.duration) {
    throw new Error(
      logPrefix + ' Could not read duration from file. Probably unusual or badly encoded file'
    )
  }
  if (!md.format.bitrate) {
    throw new Error(
      logPrefix + ' Could not read bitrate from file. Probably unusual or badly encoded file'
    )
  }
  if (!md.format.sampleRate) {
    throw new Error(
      logPrefix + ' Could not read sample rate from file. Probably unusual or badly encoded file'
    )
  }
  track.duration = md.format.duration
  track.bitrate = Math.round(md.format.bitrate)
  track.sampleRate = md.format.sampleRate
  const picture = md.common.picture
  const newFilename = generateFilename(track, xmlTrackPath, paths.tracks_dir)
  track.file = newFilename
  let artworkPath, artworkData
  if (picture && picture[0]) {
    // if the track has multiple artworks, check if if they're equal. If
    // yes, use the first one, otherwise warn
    if (picture.length > 1) {
      // Start at 1 since we're comparing two elements in the array
      for (let i = 1; i < picture.length; i++) {
        const equal = buffersEqual(picture[i - 1].data, picture[i].data)
        if (!equal) {
          warn(logPrefix + ' Found multiple unique artworks. Using the first one')
        }
      }
      // // this code is for writing the multiple artworks
      // if (!allEqual) {
      //   for (let i = 0; i < picture.length; i++) {
      //     let ext = '.jpg'
      //     if (picture[0].format === 'image/png') ext = '.png'
      //     const dir = path.join(libraryPath, 'Export', newFilename+' '+i+ext)
      //     fs.writeFileSync(dir, picture[i].data)
      //   }
      // }
    }
    const thePicture = picture[0]
    let ext = '.jpg'
    if (thePicture.format === 'image/png') ext = '.png'
    const imgFormat = thePicture.format
    if (!['image/jpeg', 'image/png'].includes(imgFormat)) {
      warn(logPrefix + ` Skipping unsupported cover format "${imgFormat}"`)
    }
    artworkPath = path.join(paths.artworks_dir, newFilename + ext)
    artworkData = thePicture.data
  }
  const newPath = path.join(paths.tracks_dir, newFilename)
  if (fs.existsSync(newPath)) {
    throw new Error(logPrefix + ' File already exists: ' + newPath)
  }
  if (fs.existsSync(artworkPath)) {
    throw new Error(logPrefix + ' File already exists: ' + artworkPath)
  }
  if (!dryRun) {
    if (artworkPath) fs.writeFileSync(artworkPath, artworkData)
    addon.copy_file(xmlTrackPath, newPath)
  }

  if (
    xml_track['Persistent ID'] === 'A7F64F85A799AA1C' || // init.seq
    xml_track['Persistent ID'] === '033D11C37D8F07CA' || // test track
    xml_track['Persistent ID'] === '7B468E51DD4EC3DB' // test track2
  ) {
    console.log(xml_track['Name'], { track, xmlTrack: xml_track })
  }

  return track
}

type XmlPlaylist = {
  Name: string
  Description?: string
  Loved?: string
  Disliked?: string
  'Playlist Persistent ID': string
}

function addCommonPlaylistFields(playlist: TrackList, xmlPlaylist: XmlPlaylist, startTime: number) {
  if (!xmlPlaylist['Name']) {
    throw new Error('Playlist missing required field "Name": ' + String(xmlPlaylist))
  }
  playlist.name = xmlPlaylist['Name']
  if (xmlPlaylist['Description']) playlist.description = xmlPlaylist['Description']
  if (xmlPlaylist['Loved']) playlist.liked = xmlPlaylist['Loved']
  if (xmlPlaylist['Disliked']) playlist.disliked = xmlPlaylist['Disliked']
  playlist.originalId = xmlPlaylist['Playlist Persistent ID']
  playlist.importedFrom = 'itunes'
  playlist.dateImported = startTime
}

type StartResult = {
  err?: Error
  cancelled: boolean
}
async function start(
  paths: Paths,
  status: (msg: string) => void,
  warn: (msg: string) => void
): Promise<StartResult> {
  // const filePath = '/Users/kasper/Downloads/Library.xml'
  // const dryRun = false
  const { filePath, dryRun } = await popup()
  if (!filePath) return { cancelled: true }

  status('Reading iTunes Library file...')
  const xml = await readPlist(filePath)

  status('Parsing iTunes Library file...')
  const version = xml['Major Version'] + '.' + xml['Minor Version']
  if (version !== '1.1') {
    warn(
      `Library.xml version: Expected 1.1, was ${version}. You might have a too new/old iTunes verison`
    )
  }
  console.log('xml:', xml)
  console.log('music folder:', xml['Music Folder'])

  status('Parsing tracks...')
  const xml_playlists = []
  let xml_music_playlist
  for (const key of Object.keys(xml.Playlists)) {
    const xml_playlist = xml.Playlists[key]
    // skip invisible playlists (should just be the "Library" playlist)
    if (xml_playlist['Visible'] === false) continue
    // skip smart playlists
    if (xml_playlist['Smart Info']) continue
    if (xml_playlist['Distinguished Kind'] && xml_playlist['Distinguished Kind'] !== 1) {
      // ignore iTunes-generated playlists
      if (xml_playlist['Distinguished Kind'] === 4) {
        // but keep the Music playlist
        if (xml_music_playlist) throw new Error('Found two iTunes-generated "Music" playlists')
        xml_music_playlist = xml_playlist
      }
    } else {
      xml_playlists.push(xml_playlist)
    }
  }
  // We import the tracks that are in the "Music" playlist since xml.Tracks
  // contains podcasts, etc.
  const xml_music_playlist_items = xml_music_playlist['Playlist Items']
  const startTime = new Date().getTime()
  const parsedTracks: Record<string, Track> = {}
  /** iTunes ID -> Ferrum ID */
  const trackIdMap: Record<string, string> = {}
  for (let i = 0; i < xml_music_playlist_items.length; i++) {
    status(`Parsing tracks... (${i + 1}/${xml_music_playlist_items.length})`)
    const xmlPlaylistItem = xml_music_playlist_items[i]
    const iTunesId = xmlPlaylistItem['Track ID']
    const xmlTrack = xml.Tracks[iTunesId]
    const track = await parseTrack(xmlTrack, warn, startTime, dryRun, paths)
    let id

    do {
      // prevent duplicate IDs
      id = makeId(7)
    } while (parsedTracks[id])
    parsedTracks[id] = track
    trackIdMap[iTunesId] = id
  }

  status('Parsing folders...')
  const parsedPlaylists: TrackListsHashMap = {
    root: {
      name: SpecialTrackListName.Root,
      id: 'root',
      type: 'special',
      dateCreated: startTime,
      children: [],
    },
  }
  const folderIdMap = {}
  for (const xml_playlist of xml_playlists) {
    if (xml_playlist['Folder'] !== true) continue
    const playlist: Folder = { type: 'folder', children: [] }
    addCommonPlaylistFields(playlist, xml_playlist, startTime)
    let id
    do {
      // prevent duplicate IDs
      id = makeId(7)
    } while (parsedPlaylists[id])
    parsedPlaylists[id] = playlist
    const itunesId = playlist.originalId
    folderIdMap[itunesId] = id
  }
  for (const xml_playlist of xml_playlists) {
    if (xml_playlist['Folder'] !== true) continue
    const itunesId = xml_playlist['Playlist Persistent ID']
    const id = folderIdMap[itunesId]
    const playlist = parsedPlaylists[id]
    const parentItunesId = xml_playlist['Parent Persistent ID']
    const parentId = folderIdMap[parentItunesId]
    if (parentId) {
      const parent = parsedPlaylists[parentId]
      if (!parent) {
        throw new Error(`Could not find folder of playlist "${playlist.name}"`)
      }
      parent.children.push(id)
    } else {
      parsedPlaylists.root.children.push(id)
    }
  }

  status('Parsing playlists...')
  for (const xmlPlaylist of xml_playlists) {
    if (xmlPlaylist['Folder'] === true) continue
    const playlist = { type: 'playlist', tracks: [] }
    addCommonPlaylistFields(playlist, xmlPlaylist, startTime)

    const parentItunesId = xmlPlaylist['Parent Persistent ID']
    const parentId = folderIdMap[parentItunesId]
    let id
    do {
      // prevent duplicate IDs
      id = makeId(7)
    } while (parsedTracks[id])

    if (parentId) {
      const parent = parsedPlaylists[parentId]
      if (!parent) {
        throw new Error(`Could not find folder of playlist "${playlist.name}"`)
      }
      parent.children.push(id)
    } else {
      parsedPlaylists.root.children.push(id)
    }
    if (xmlPlaylist['Playlist Items']) {
      for (const item of xmlPlaylist['Playlist Items']) {
        const itunesTrackId = item['Track ID']
        const trackId = trackIdMap[itunesTrackId]
        // skip podcasts etc by checking if it's in parsedTracks
        if (parsedTracks[trackId]) {
          playlist.tracks.push(trackId)
        }
      }
    }
    parsedPlaylists[id] = playlist
  }
  console.log('parsedPlaylists:', parsedPlaylists)

  console.log('LIB', { tracks: parsedTracks, trackLists: parsedPlaylists })
  if (dryRun) return { cancelled: true }

  status('Saving...')
  const newLibrary = {
    version: 1,
    tracks: parsedTracks,
    trackLists: parsedPlaylists,
    playTime: [],
  }
  const json = JSON.stringify(newLibrary, null, '  ')
  await addon.atomic_file_save(paths.library_json, json)
  return { cancelled: false }
}
