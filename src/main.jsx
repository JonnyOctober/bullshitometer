import React from "react";
import { createRoot } from "react-dom/client";
import Bullshitometer from "./Bullshitometer.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Bullshitometer />
  </React.StrictMode>
);
