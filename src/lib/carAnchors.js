// Pure helper (no imports) so plain Node scripts can use it with the manifest they read.
/** Multiple candidates let a part's marker follow the visible side of the real car. */
export function anchorsFromRelease(release) {
  return Object.fromEntries(Object.entries(release?.anchors ?? {}).map(([part, candidates]) => [
    part, candidates.map(({ position, normal }) => ({ position: [...position], normal: [...normal] })),
  ]));
}
