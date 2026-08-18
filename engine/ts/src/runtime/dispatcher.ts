/**
 * The serialization seam: everything touching a view's state runs through
 * its dispatcher, one item at a time.
 *
 * JavaScript is single-threaded, so the default runs work inline: the
 * thread itself provides the serialization the other runtimes get from a
 * main-thread queue. Re-entrancy is handled by the view's own work queue,
 * so an update can never land mid-action-list. The conformance harness
 * injects a deterministic pump instead.
 */
export interface MilanoDispatcher {
  dispatch(work: () => void): void;
}

export const inlineDispatcher: MilanoDispatcher = Object.freeze({
  dispatch(work: () => void): void {
    work();
  },
});
