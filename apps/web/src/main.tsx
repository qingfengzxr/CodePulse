import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { PreferencesProvider } from "./app/preferences";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreferencesProvider>
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </PreferencesProvider>
  </React.StrictMode>,
);
