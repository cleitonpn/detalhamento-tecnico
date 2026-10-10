import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/tokens.css";
import "./styles/app.css";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="loading-page">
          <h1>A visualização não pôde ser aberta</h1>
          <p>
            Confira se o navegador permite WebGL e recarregue a página. Os
            projetos salvos continuam preservados.
          </p>
          <button className="button primary" onClick={() => location.reload()}>
            Recarregar
          </button>
        </div>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
