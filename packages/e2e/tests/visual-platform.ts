// System font fallback and glyph rasterization are OS-specific. Keep the
// original Windows references and review separate references on other hosts.
export function visualPlatformName(name: string): string {
  return process.platform === "win32" ? name : name.replace(/\.png$/u, `-${process.platform}.png`);
}
