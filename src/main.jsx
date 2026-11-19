import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ProjectDataProvider } from './hooks/useProjectData.jsx';
import { GarageStateProvider } from './hooks/useGarageState.jsx';
import { scrubSensitiveUrl } from './lib/urlScrub.js';
import { initClientMonitoring } from './lib/monitoring.js';
import './styles/tokens.css';
import './styles/global.css';
import './styles/garage.css';
import './styles/pages.css';
import './styles/refinements.css';
import './styles/studio.css';
import './styles/parts-cards.css';
import './styles/supporter-features.css';

// Before the router or any tracker reads the address (see urlScrub.js).
scrubSensitiveUrl();
initClientMonitoring();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ProjectDataProvider>
        <GarageStateProvider>
          <App />
        </GarageStateProvider>
      </ProjectDataProvider>
    </BrowserRouter>
  </StrictMode>,
);
