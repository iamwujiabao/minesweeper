// Settings as a file, shared by all views: download the JSON, and read an uploaded one.
const SettingsFile = {
  download(text, name = 'minesweeper-settings.json') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  // Resolves to the file's text. A settings file is under 2 KB, so anything big is refused before reading.
  async read(file) {
    if (file.size > 100000) throw new Error('File is too large to be a settings file');
    return file.text();
  },
};
