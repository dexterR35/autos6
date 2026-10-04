import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ProjectDataProvider } from './hooks/useProjectData.jsx';
import { GarageStateProvider } from './hooks/useGarageState.jsx';
import './styles/tokens.css';
import './styles/global.css';
import './styles/garage.css';
import './styles/pages.css';

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
