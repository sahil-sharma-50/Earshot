import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { Run } from './pages/Run.js';

// run.html is the run view only; the home page is its own page (index.html).
const RUN_PATH = /^\/run\/([a-f0-9]{6,32})\/?$/;

function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const m = RUN_PATH.exec(path);
  const isRun = m !== null;
  useEffect(() => { if (!isRun) location.replace('/'); }, [isRun]);
  return m ? <Run runId={m[1]!} /> : null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
