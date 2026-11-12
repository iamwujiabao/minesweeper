// Files: download some JSON text, and read an uploaded file as text.
const SettingsFile = {
  download(text, name = 'minesweeper-settings.json') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  // Resolves to the file's text. Settings and game files are small (well under 100 KB), so anything bigger is refused before reading.
  async read(file) {
    if (file.size > 100000) throw new Error('File is too large to be a settings file');
    return file.text();
  },
};
