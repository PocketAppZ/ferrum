use crate::data::Data;
use crate::data_js::get_data;
use crate::library_types::{Library, SpecialTrackListName, TrackID, TrackList};
use crate::{str_to_option, UniResult};
use napi::{Env, JsUnknown, Result};
use std::collections::HashSet;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
use trash::macos::TrashContextExtMacos;

#[napi(js_name = "get_track_lists", ts_return_type = "TrackListsHashMap")]
#[allow(dead_code)]
pub fn get_track_lists(env: Env) -> Result<JsUnknown> {
  let data: &mut Data = get_data(&env)?;
  let track_lists = &data.library.trackLists;
  let js = env.to_js_value(&track_lists)?;
  return Ok(js);
}

#[napi(js_name = "add_tracks_to_playlist")]
#[allow(dead_code)]
pub fn add_tracks(playlist_id: String, mut track_ids: Vec<String>, env: Env) -> Result<()> {
  let data: &mut Data = get_data(&env)?;
  let playlist = match data.library.get_tracklist_mut(&playlist_id)? {
    TrackList::Playlist(playlist) => playlist,
    TrackList::Folder(_) => throw!("Cannot add track to folder"),
    TrackList::Special(_) => throw!("Cannot add track to special playlist"),
  };
  playlist.tracks.append(&mut track_ids);
  return Ok(());
}

#[napi(js_name = "playlist_filter_duplicates")]
#[allow(dead_code)]
pub fn filter_duplicates(playlist_id: String, ids: Vec<String>, env: Env) -> Result<Vec<TrackID>> {
  let data: &mut Data = get_data(&env)?;
  let mut track_ids: HashSet<String> = HashSet::from_iter(ids.into_iter());
  let playlist = match data.library.get_tracklist_mut(&playlist_id)? {
    TrackList::Playlist(playlist) => playlist,
    _ => throw!("Cannot check if folder/special contains track"),
  };
  for track in &playlist.tracks {
    if track_ids.contains(track) {
      track_ids.remove(track);
    }
  }
  let track_ids: Vec<TrackID> = track_ids.into_iter().collect();
  Ok(track_ids)
}

#[napi(js_name = "remove_from_open_playlist")]
#[allow(dead_code)]
pub fn remove_from_open(mut indexes_to_remove: Vec<u32>, env: Env) -> Result<()> {
  let data: &mut Data = get_data(&env)?;
  indexes_to_remove.sort_unstable();
  indexes_to_remove.dedup();
  let playlist = match data.library.get_tracklist_mut(&data.open_playlist_id)? {
    TrackList::Playlist(playlist) => playlist,
    TrackList::Folder(_) => throw!("Cannot remove track from folder"),
    TrackList::Special(_) => throw!("Cannot remove track from special playlist"),
  };
  if data.sort_key != "index" || data.sort_desc != true {
    throw!("Cannot remove track when custom sorting is used");
  }
  if data.filter != "" {
    throw!("Cannot remove track when filter is used");
  }
  let mut new_list = Vec::new();
  let mut indexes_to_remove = indexes_to_remove.iter();
  let mut next_index = indexes_to_remove.next().map(|n| *n as usize);
  for i in 0..playlist.tracks.len() {
    let id = playlist.tracks.remove(0);
    if Some(i) == next_index {
      next_index = indexes_to_remove.next().map(|n| *n as usize);
    } else {
      new_list.push(id);
    }
  }
  playlist.tracks = new_list;
  return Ok(());
}

fn remove_from_all_playlists(library: &mut Library, id: &str) {
  for (_, tracklist) in &mut library.trackLists {
    let playlist = match tracklist {
      TrackList::Playlist(playlist) => playlist,
      _ => continue,
    };
    playlist.tracks.retain(|current_id| current_id != id);
  }
}

fn get_page_ids(data: &mut Data, indexes: Vec<u32>) -> UniResult<Vec<String>> {
  let mut ids = Vec::new();
  let page_track_ids = data.get_page_tracks();
  for index in indexes {
    let id = match page_track_ids.get(index as usize) {
      Some(id) => id,
      None => throw!("Track index not found"),
    };
    ids.push(id.clone());
  }
  Ok(ids)
}

fn delete_file(path: &PathBuf) -> UniResult<()> {
  #[allow(unused_mut)]
  let mut trash_context = trash::TrashContext::new();

  #[cfg(target_os = "macos")]
  trash_context.set_delete_method(trash::macos::DeleteMethod::NsFileManager);

  match trash_context.delete(&path) {
    Ok(_) => Ok(()),
    Err(_) => throw!("Failed moving file to trash: {}", path.to_string_lossy()),
  }
}

#[napi(js_name = "delete_tracks_in_open")]
#[allow(dead_code)]
pub fn delete_tracks_in_open(mut indexes_to_delete: Vec<u32>, env: Env) -> Result<()> {
  let data: &mut Data = get_data(&env)?;
  indexes_to_delete.sort_unstable();
  indexes_to_delete.dedup();
  let ids_to_delete = get_page_ids(data, indexes_to_delete)?;
  let library = &mut data.library;

  for id_to_delete in &ids_to_delete {
    let file_path = {
      let track = library.get_track(id_to_delete)?;
      data.paths.tracks_dir.join(&track.file)
    };
    if !file_path.exists() {
      throw!("File does not exist: {}", file_path.to_string_lossy());
    }

    remove_from_all_playlists(library, &id_to_delete);
    library
      .tracks
      .remove(id_to_delete)
      .expect("Track ID not found when deleting");
    delete_file(&file_path)?;
  }
  return Ok(());
}

#[napi(js_name = "new_playlist")]
#[allow(dead_code)]
pub fn new_playlist(
  name: String,
  description: String,
  is_folder: bool,
  parent_id: String,
  env: Env,
) -> Result<()> {
  let data: &mut Data = get_data(&env)?;
  let library = &mut data.library;

  let list = match is_folder {
    true => {
      let folder = library.new_folder(name, str_to_option(description));
      TrackList::Folder(folder)
    }
    false => {
      let playlist = library.new_playlist(name, str_to_option(description));
      TrackList::Playlist(playlist)
    }
  };

  let parent = match library.trackLists.get_mut(&parent_id) {
    Some(parent) => parent,
    None => throw!("Parent not found"),
  };

  match parent {
    TrackList::Playlist(_) => throw!("Parent cannot be playlist"),
    TrackList::Folder(folder) => {
      folder.children.push(list.id().to_string());
      library.trackLists.insert(list.id().to_string(), list);
    }
    TrackList::Special(special) => match special.name {
      SpecialTrackListName::Root => {
        special.children.push(list.id().to_string());
        library.trackLists.insert(list.id().to_string(), list);
      }
    },
  };

  return Ok(());
}

#[napi(js_name = "update_playlist")]
#[allow(dead_code)]
pub fn update_playlist(id: String, name: String, description: String, env: Env) -> Result<()> {
  let data: &mut Data = get_data(&env)?;

  match data.library.trackLists.get_mut(&id) {
    Some(TrackList::Special(_)) => throw!("Cannot edit special playlists"),
    Some(TrackList::Playlist(playlist)) => {
      playlist.name = name;
      playlist.description = str_to_option(description);
    }
    Some(TrackList::Folder(folder)) => {
      folder.name = name;
      folder.description = str_to_option(description);
    }
    None => throw!("Playlist not found"),
  };

  return Ok(());
}

fn get_all_tracklist_children(data: &Data, playlist_id: &str) -> UniResult<Vec<TrackID>> {
  let direct_children = match data.library.get_tracklist(playlist_id)? {
    TrackList::Folder(folder) => &folder.children,
    TrackList::Special(special) => &special.children,
    TrackList::Playlist(_) => return Ok(Vec::new()),
  };
  let mut all_children = Vec::new();
  for child_id in direct_children {
    all_children.push(child_id.clone());
    match data.library.get_tracklist(child_id)? {
      TrackList::Playlist(_) => {}
      TrackList::Folder(folder) => {
        all_children.extend(get_all_tracklist_children(data, &folder.id)?)
      }
      TrackList::Special(special) => {
        all_children.extend(get_all_tracklist_children(data, &special.id)?)
      }
    }
  }
  Ok(all_children)
}

fn get_children_if_user_editable<'a>(
  library: &'a mut Library,
  id: &'a str,
) -> UniResult<&'a mut Vec<String>> {
  let children = match library.trackLists.get_mut(id) {
    Some(TrackList::Folder(folder)) => &mut folder.children,
    Some(TrackList::Special(special)) => match special.name {
      SpecialTrackListName::Root => &mut special.children,
    },
    None => throw!("Attempted to move from/to non-existant folder"),
    _ => throw!("Attempted to move from/to non-folder"),
  };
  Ok(children)
}

#[napi(js_name = "move_playlist")]
#[allow(dead_code)]
pub fn move_playlist(id: String, from_id: String, to_id: String, env: Env) -> Result<()> {
  let data: &mut Data = get_data(&env)?;

  match data.library.trackLists.get(&id) {
    Some(TrackList::Special(_)) => throw!("Cannot move special playlist"),
    None => throw!("List not found"),
    _ => {}
  };

  // check that the to_id is valid before we remove it from from_id
  get_children_if_user_editable(&mut data.library, &to_id)?;

  let from_id_children = get_all_tracklist_children(&data, &id)?;
  if from_id_children.contains(&to_id) {
    throw!("Cannot move playlist to a child of itself");
  }

  let children = get_children_if_user_editable(&mut data.library, &from_id)?;
  let i = match children.iter().position(|child_id| child_id == &id) {
    None => throw!("Could not find playlist"),
    Some(i) => i,
  };
  children.remove(i);

  let to_folder_children = get_children_if_user_editable(&mut data.library, &to_id)?;
  to_folder_children.push(id.clone());

  Ok(())
}
