import { Component, type ReactNode } from "react";

/** Fail loudly on screen: a render error shows its message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice bad" role="alert">
        <b>Something broke while drawing this view.</b>
        <div className="pmeta" style={{ whiteSpace: "pre-wrap" }}>{String(this.state.error.stack ?? this.state.error)}</div>
        <button className="linkish" onClick={() => { window.location.href = window.location.pathname; }}>Reset filters and reload</button>
      </div>
    );
  }
}
