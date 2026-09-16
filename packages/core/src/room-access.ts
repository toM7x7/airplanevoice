/** One-way derivation: the visitor link cannot recover the editing capability. */
export async function visitorKey(editKey: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`airplanevoice-visitor-v1:${editKey}`),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
