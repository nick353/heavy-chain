export function getCurrentPlatform(): string {
  if (typeof navigator === 'undefined') return '';
  return `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
}

export function getShortcutModifier(platform = getCurrentPlatform()): '⌘' | 'Ctrl' {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘' : 'Ctrl';
}

export function formatShortcutLabel(label: string, platform = getCurrentPlatform()): string {
  return label.replace(/⌘/g, getShortcutModifier(platform));
}

export function formatShortcutKeys(keys: string[], platform = getCurrentPlatform()): string[] {
  return keys.map((key) => key === '⌘' ? getShortcutModifier(platform) : key);
}
