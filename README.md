# Ferrum

Ferrum is a music library client.

## Dev instructions

### ToDo
- Fix PlayTime id null bug
- Write tags to files:
  - m4a/aac: https://github.com/Saecki/rust-mp4ameta
  - mp3/mp3: https://github.com/polyfloyd/rust-id3
  - audiotags
- Check if a track is VBR. Can we use codecProfile? What about non-mp3s?
- Look into playing audio from Rust to reduce CPU usage
- iTunes Import overwrites library, but old track/artwork files are still kept. Either move or delete them
- Volume normalization
- Databases
  - https://github.com/TheNeikos/rustbreak
  - https://github.com/spacejam/sled
  - https://github.com/Owez/tinydb
- Gapless audio
  - https://github.com/RustAudio/rodio
  - https://github.com/regosen/Gapless-5
  - https://github.com/sudara/stitches
  - https://www.npmjs.com/package/gapless.js

### Get started

1. Install Node.js (v12 works)
2. Install Rust (v1.48 works)
3. Run `npm install`

### Commands

#### `npm run start`
Start dev server + Electron
#### `npm run build`
Build UI into `public/build/`, then app into `dist/`
#### `npm run snowpack:build`
Build UI into `public/build/`
#### `npm run lint`
Format code
#### `npm run check`
Check for compiler errors and unused css

### Publish new version
1. Update `CHANGELOG.md`
2. Bump the `package.json` version number
    ```
    npm version --no-git-tag <version>
    ```
3. Manually bump the version number in `native/Cargo.toml`
4. Check for errors and bump the `Cargo.lock` version number
    ```
    cargo check --manifest-path native/Cargo.toml
    ```
5. Commit and tag in format "v#.#.#"
6. Build the app
    ```
    npm run build
    ```
7. Create GitHub release with release notes
