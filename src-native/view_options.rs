use crate::data::Data;
use crate::data_js::get_data;
use crate::library::Paths;
use crate::{path_to_json, UniResult};
use atomicwrites::AtomicFile;
use atomicwrites::OverwriteBehavior::AllowOverwrite;
use napi::{Env, Result};
use serde::{Deserialize, Serialize};
use std::io::Write;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[napi(object)]
pub struct ViewOptions {
	pub shown_playlist_folders: Vec<String>,
	/// Empty is treated as default
	pub columns: Vec<String>,
}
impl ViewOptions {
	pub fn load(paths: &Paths) -> ViewOptions {
		match path_to_json(paths.local_data_dir.join("view.json")) {
			Ok(view_cache) => view_cache,
			Err(_) => ViewOptions {
				shown_playlist_folders: Vec::new(),
				columns: Vec::new(),
			},
		}
	}
	pub fn save(&self, paths: &Paths) -> UniResult<()> {
		let json_str = match serde_json::to_string(self) {
			Ok(json_str) => json_str,
			Err(_) => throw!("Error saving view.json"),
		};
		let file_path = paths.local_data_dir.join("view.json");
		let af = AtomicFile::new(file_path, AllowOverwrite);
		let result = af.write(|f| f.write_all(json_str.as_bytes()));
		match result {
			Ok(_) => {}
			Err(_) => throw!("Error writing view.json"),
		};
		Ok(())
	}
}
#[napi(js_name = "shown_playlist_folders")]
#[allow(dead_code)]
pub fn shown_playlist_folders(env: Env) -> Result<Vec<String>> {
	let data: &Data = get_data(&env)?;
	let shown_folders = &data.view_options.shown_playlist_folders;
	Ok(shown_folders.iter().cloned().collect())
}
#[napi(js_name = "view_folder_set_show")]
#[allow(dead_code)]
pub fn view_folder_set_show(id: String, show: bool, env: Env) -> Result<()> {
	let data: &mut Data = get_data(&env)?;
	data.view_options
		.shown_playlist_folders
		.retain(|folder| folder != &id);
	if show {
		data.view_options.shown_playlist_folders.push(id);
	}
	data.view_options.save(&data.paths)?;
	Ok(())
}

#[napi(js_name = "load_view_options")]
#[allow(dead_code)]
pub fn load_view_options(env: Env) -> Result<ViewOptions> {
	let data: &Data = get_data(&env)?;
	Ok(data.view_options.clone())
}
#[napi(js_name = "save_view_options")]
#[allow(dead_code)]
pub fn save_view_options(view_options: ViewOptions, env: Env) -> Result<()> {
	let data: &mut Data = get_data(&env)?;
	data.view_options = view_options;
	data.view_options.save(&data.paths)?;
	Ok(())
}
