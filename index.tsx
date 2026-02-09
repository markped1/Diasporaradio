
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { BroadcastProvider } from './context/BroadcastContext';

// Basic error catcher to avoid the "Blank Green Screen"
window.onerror = function (msg, url, lineNo, columnNo, error) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding: 20px; background: #fff; border: 5px solid red; color: red; font-family: sans-serif; position: fixed; top:0; left:0; width:100%; z-index:9999;">
        <h1>⚠️ App Startup Error</h1>
        <p><strong>Message:</strong> ${msg}</p>
        <p><strong>File:</strong> ${url}</p>
        <p><strong>Line:</strong> ${lineNo}</p>
        <p style="font-size: 10px; margin-top: 10px; color: #666;">Check your Vercel Environment Variables if this is on production.</p>
        <button onclick="window.location.reload()" style="padding: 10px; background: #008751; color: white; border: none; border-radius: 5px; cursor: pointer;">Try Refreshing</button>
      </div>
    `;
  }
  return false;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);

try {
  root.render(
    <React.StrictMode>
      <BroadcastProvider>
        <App />
      </BroadcastProvider>
    </React.StrictMode>
  );
} catch (e: any) {
  rootElement.innerHTML = `<div style="color: red; padding: 20px;"><h1>Render Crash</h1><p>${e.message}</p></div>`;
}
