//! When requiring new files, add them in package.json build.files
const { app } = require('electron')
const dev = process.env.NODE_ENV === 'development'
if (dev) app.setName('Ferrum Dev')

const { ipcMain, session, Menu, BrowserWindow, protocol } = require('electron')
const path = require('path')
const vars = require('./variables.json')

const appData = app.getPath('appData')
const electronDataPath = path.join(appData, app.name, 'Electron Data')
app.setPath('userData', electronDataPath)

let devPort
if (dev) {
  const SnowpackUserConfig = require('../snowpack.config.js')
  devPort = SnowpackUserConfig.devOptions.port
}
const isMac = process.platform === 'darwin'

let mainWindow
let quitting = false

function ready() {
  protocol.registerFileProtocol('file', (request, callback) => {
    const url = request.url.substr(7)
    callback(decodeURI(url))
  })

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 1000,
    minWidth: 850,
    minHeight: 400,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: false,
      // Allow file:// during development, since the app is loaded via http
      webSecurity: !dev,
      nodeIntegration: true,
      enableRemoteModule: true,
      preload: path.resolve(__dirname, './electron/preload.js'),
    },
    backgroundColor: vars['--bg-color'],
    show: false,
  })

  // Electron shows a warning when unsafe-eval is enabled, so we disable
  // security warnings. Somehow devtools doesn't open without unsafe-eval.
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = true
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["script-src 'self' 'unsafe-inline' 'unsafe-eval';"],
      },
    })
  })

  if (dev) mainWindow.loadURL('http://localhost:' + devPort)
  else mainWindow.loadFile(path.resolve(__dirname, '../public/index.html'))

  if (dev) mainWindow.webContents.openDevTools()

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', ready)

app.on('before-quit', () => {
  mainWindow.webContents.send('gonnaQuit')
  ipcMain.once('readyToQuit', () => {
    quitting = true
    mainWindow.close()
  })
})
app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) ready()
  else mainWindow.show()
})

const template = [
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideothers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : []),
  {
    label: 'File',
    submenu: [
      {
        label: 'Import iTunes Library...',
        click: () => {
          mainWindow.webContents.send('itunesImport')
        },
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? [
            // { role: 'pasteAndMatchStyle' },
            // { role: 'delete' },
            { role: 'selectAll' },
            { type: 'separator' },
            // {
            //   label: 'Speech',
            //   submenu: [
            //     { role: 'startSpeaking' },
            //     { role: 'stopSpeaking' },
            //   ],
            // },
          ]
        : [
            // { role: 'delete' },
            { type: 'separator' },
            { role: 'selectAll' },
          ]),
    ],
  },
  {
    label: 'Song',
    submenu: [{ label: 'TBA' }],
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  {
    label: 'Playback',
    submenu: [
      {
        label: 'Pause',
        // accelerator: 'Space',
        click: () => {
          mainWindow.webContents.send('playPause')
        },
      },
    ],
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            // { role: 'window' },
          ]
        : [{ role: 'close' }]),
    ],
  },
  {
    role: 'help',
    submenu: [
      {
        label: 'Learn More',
        click: async () => {
          const { shell } = require('electron')
          await shell.openExternal('https://github.com/probablykasper/ferrum')
        },
      },
    ],
  },
]
const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)
