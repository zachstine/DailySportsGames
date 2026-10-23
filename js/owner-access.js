// Re-check every auth change. A late response must never reopen a signed-out desk.
export function createOwnerAccess({ verify, lock, unlock, deny }) {
  let revision = 0,
    dispose;
  return {
    async check(user) {
      const request = ++revision;
      dispose?.();
      dispose = null;
      lock(user);
      if (!user) return;
      const current = () => request === revision;
      try {
        const allowed = await verify(user.uid);
        if (!current()) return;
        if (!allowed) {
          deny();
          return;
        }
        const cleanup = await unlock(user, current);
        if (!current()) cleanup?.();
        else dispose = cleanup;
      } catch (error) {
        if (current()) {
          lock(user);
          deny(error);
        }
      }
    },
  };
}
