export type LeaveState = { dirty: boolean; blocked: boolean; paused: boolean };

// Read stores at the moment of navigation, including writes started before React renders.
export function createWorkspaceNavigation() {
  const workspaces = new Set<() => LeaveState>();
  return {
    register(read: () => LeaveState) {
      workspaces.add(read);
      return () => {
        workspaces.delete(read);
      };
    },
    snapshot(): LeaveState {
      const states = [...workspaces].map((read) => read());
      return {
        dirty: states.some((state) => state.dirty),
        blocked: states.some((state) => state.blocked),
        paused: states.some((state) => state.paused),
      };
    },
    allow(
      confirm: (message: string) => boolean,
      purpose: boolean | "discard" = false,
    ) {
      const state = this.snapshot();
      if (state.blocked || (state.paused && purpose !== true)) return false;
      return (
        !state.dirty ||
        confirm(
          purpose === "discard"
            ? "Discard entered unsaved edits?"
            : purpose === true
              ? "Sign out? Unsaved edits will be discarded only when sign out is confirmed."
              : "Leave this workspace? Unsaved edits stay in this session, but have not been saved. Reloading or ending the session will lose them.",
        )
      );
    },
  };
}
