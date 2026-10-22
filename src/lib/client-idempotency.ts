/** In-memory action identities. Keep this instance in a component ref, not render state.
 * Unknown outcomes retain their key. Only a changed request or confirmed successful
 * action creates a fresh identity. Keys are opaque; never put payment data in them.
 * This is not persistence across unmounts/reloads or a replacement for server receipts.
 */
export class ClientMutationKeys {
  private readonly actions = new Map<string, { body: string; key: string }>();

  keyFor(url: string, body: string): string {
    let action = this.actions.get(url);
    if (!action || action.body !== body) {
      action = { body, key: crypto.randomUUID() };
      this.actions.set(url, action);
    }
    return action.key;
  }

  complete(url: string, key: string): void {
    if (this.actions.get(url)?.key === key) this.actions.delete(url);
  }
}
