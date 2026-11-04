/** Names where the room reading came from; the Pod's own sensor reads warm, so it never claims to be the room. */
export const roomLabel = (source: string | null | undefined): string => source ? `Room · ${source}` : 'Hub air'
