use crate::get_now_timestamp;
use crate::library_types::{Library, Special, SpecialTrackListName, TrackList, Version};
use linked_hash_map::LinkedHashMap;
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, File};
use std::io::{Error, ErrorKind, Read};
use std::path::PathBuf;
use std::time::Instant;

#[derive(Serialize, Deserialize)]
pub struct Paths {
  pub library_dir: PathBuf,
  pub tracks_dir: PathBuf,
  pub artworks_dir: PathBuf,
  pub library_json: PathBuf,
}
fn ensure_dirs_exists(paths: &Paths) -> Result<(), Error> {
  create_dir_all(&paths.library_dir)?;
  create_dir_all(&paths.tracks_dir)?;
  create_dir_all(&paths.artworks_dir)?;
  return Ok(());
}

pub fn load_library(paths: &Paths) -> Library {
  let mut now = Instant::now();

  match ensure_dirs_exists(&paths) {
    Ok(_) => {}
    Err(err) => panic!("Error ensuring folder exists: {}", err),
  };

  match File::open(&paths.library_json) {
    Ok(mut file) => {
      let mut json_str = String::new();
      match file.read_to_string(&mut json_str) {
        Ok(_) => {}
        Err(err) => panic!("Error reading library file: {}", err),
      };
      println!("Read library: {}ms", now.elapsed().as_millis());
      now = Instant::now();

      let library = match serde_json::from_str(&mut json_str) {
        Ok(library) => library,
        Err(err) => panic!("Error parsing library file: {:?}", err),
      };

      println!("Parse library: {}ms", now.elapsed().as_millis());
      return library;
    }
    Err(err) => match err.kind() {
      ErrorKind::NotFound => {
        let mut track_lists = LinkedHashMap::new();
        let root = Special {
          id: "root".to_string(),
          name: SpecialTrackListName::Root,
          dateCreated: get_now_timestamp(),
          children: Vec::new(),
        };
        track_lists.insert("root".to_string(), TrackList::Special(root));
        return Library {
          version: Version::V1,
          playTime: Vec::new(),
          tracks: LinkedHashMap::new(),
          trackLists: track_lists,
        };
      }
      _err_kind => panic!("Error opening library file: {}", err),
    },
  };
}

pub enum TrackField {
  String,
  F64,
  I64,
  I32,
  I16,
  U8,
  Bool,
}

pub fn get_track_field_type(field: &str) -> Option<TrackField> {
  let field = match field {
    "size" => TrackField::I64,
    "duration" => TrackField::F64,
    "bitrate" => TrackField::F64,
    "sampleRate" => TrackField::F64,
    "file" => TrackField::String,
    "dateModified" => TrackField::I64,
    "dateAdded" => TrackField::I64,
    "name" => TrackField::String,
    "importedFrom" => TrackField::String,
    "originalId" => TrackField::String,
    "artist" => TrackField::String,
    "composer" => TrackField::String,
    "sortName" => TrackField::String,
    "sortArtist" => TrackField::String,
    "sortComposer" => TrackField::String,
    "genre" => TrackField::String,
    "rating" => TrackField::U8,
    "year" => TrackField::I16,
    "bpm" => TrackField::F64,
    "comments" => TrackField::String,
    "grouping" => TrackField::String,
    "liked" => TrackField::Bool,
    "disliked" => TrackField::Bool,
    "disabled" => TrackField::Bool,
    "compilation" => TrackField::Bool,
    "albumName" => TrackField::String,
    "albumArtist" => TrackField::String,
    "sortAlbumName" => TrackField::String,
    "sortAlbumArtist" => TrackField::String,
    "trackNum" => TrackField::I16,
    "trackCount" => TrackField::I16,
    "discNum" => TrackField::I16,
    "discCount" => TrackField::I16,
    "dateImported" => TrackField::I64,
    "playCount" => TrackField::I32,
    "skipCount" => TrackField::I32,
    "volume" => TrackField::U8,
    _ => return None,
  };
  return Some(field);
}
