// Ports: interfaces only, no I/O. Concrete implementations live in server/src/adapters/*.
// NOTE: in the real repo this file already exists - add this interface to it
// (and export it from the @devdigest/shared index); do not replace the file.

export interface DigestNotifier {
  /** Publish a generated digest to an external channel. */
  notifyDigest(title: string, body: string): Promise<void>;
}
