import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { Home } from './pages/Home.js';
import { Run } from './pages/Run.js';

function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const m = /^\/run\/([a-f0-9]{6,32})\/?$/.exec(path);
  return m ? <Run runId={m[1]!} /> : <Home />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
