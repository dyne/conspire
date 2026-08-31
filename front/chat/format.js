export function humanFileSize(bytes, spin) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let size = value;
  let unit = -1;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  let result = unit < 0 ? `${size} B` : `${size.toFixed(1)} ${units[unit]}`;
  if (spin) {
    const progress = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    result += ` (${progress[Math.trunc(spin / 100) % progress.length]}${progress[Math.trunc(spin / 10) % progress.length]}${progress[spin % progress.length]})`;
  }
  return result;
}
