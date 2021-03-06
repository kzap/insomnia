import electron from 'electron';
import path from 'path';
import fs from 'fs';
import LocalStorage from '../common/local-storage';
import {getAppName, isDevelopment, isMac} from '../common/constants';

const {app, Menu, BrowserWindow, shell, dialog} = electron;

let mainWindow = null;
let localStorage = null;

export function init () {
  initLocalStorage();
  initContextMenus();
}

export function createWindow () {
  const zoomFactor = getZoomFactor();
  const {bounds, fullscreen} = getBounds();
  const {x, y, width, height} = bounds;

  // Make sure we don't place the window outside of the visible space
  let maxX = 0;
  let maxY = 0;
  for (const d of electron.screen.getAllDisplays()) {
    // Set the maximum placement location to 50 pixels short of the end
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width - 50);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height - 50);
  }
  const finalX = Math.min(maxX, x);
  const finalY = Math.min(maxX, y);

  mainWindow = new BrowserWindow({
    // Make sure we don't initialize the window outside the bounds
    x: finalX,
    y: finalY,
    fullscreen: fullscreen,
    fullscreenable: true,
    title: getAppName(),
    width: width || 1200,
    height: height || 600,
    minHeight: 500,
    minWidth: 500,
    acceptFirstMouse: true,
    icon: path.resolve(__dirname, 'static/icon.png'),
    webPreferences: {
      zoomFactor: zoomFactor
    }
  });

  let _resizeTimeout = null;
  mainWindow.on('resize', e => {
    saveBounds();

    clearTimeout(_resizeTimeout);
    _resizeTimeout = setTimeout(() => {
      trackEvent('Window', 'Resize');
    }, 1000);
  });

  let _moveTimeout = null;
  mainWindow.on('move', e => {
    saveBounds();

    clearTimeout(_moveTimeout);
    _moveTimeout = setTimeout(() => {
      trackEvent('Window', 'Move');
    }, 1000);
  });

  mainWindow.on('unresponsive', e => {
    showUnresponsiveModal();
    trackEvent('Window', 'Unresponsive');
  });

  // and load the app.html of the app.
  // TODO: Use path.join for this
  mainWindow.loadURL(`file://${__dirname}/renderer.html`);

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
    trackEvent('Window', 'Close');
  });

  const applicationMenu = {
    label: 'Application',
    submenu: [
      ...(isMac() ? [
        {label: `About ${getAppName()}`, role: 'about'},
        {type: 'separator'}
      ] : []),
      {
        label: 'Preferences',
        accelerator: 'CmdOrCtrl+,',
        click: function (menuItem, window, e) {
          if (!window || !window.webContents) {
            return;
          }
          window.webContents.send('toggle-preferences');
          trackEvent('App Menu', 'Preferences');
        }
      },
      {
        label: 'Changelog',
        click: function (menuItem, window, e) {
          if (!window || !window.webContents) {
            return;
          }
          window.webContents.send('toggle-changelog');
          trackEvent('App Menu', 'Changelog');
        }
      },
      ...(isMac() ? [
        {type: 'separator'},
        {role: 'hide'},
        {role: 'hideothers'}
      ] : []),
      {type: 'separator'},
      {label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit()}
    ]
  };

  const editMenu = {
    label: 'Edit',
    submenu: [
      {label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:'},
      {label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:'},
      {type: 'separator'},
      {label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:'},
      {label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:'},
      {label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:'},
      {label: 'Select All', accelerator: 'CmdOrCtrl+A', selector: 'selectAll:'}
    ]
  };

  const viewMenu = {
    label: 'View',
    submenu: [
      {role: 'togglefullscreen'},
      {
        label: 'Actual Size',
        accelerator: 'CmdOrCtrl+0',
        click: () => {
          const window = BrowserWindow.getFocusedWindow();
          if (!window || !window.webContents) {
            return;
          }

          const zoomFactor = 1;
          window.webContents.setZoomFactor(zoomFactor);
          saveZoomFactor(zoomFactor);
          trackEvent('App Menu', 'Zoom Reset');
        }
      },
      {
        label: 'Zoom In',
        accelerator: isMac() ? 'CmdOrCtrl+Plus' : 'CmdOrCtrl+=',
        click: () => {
          const window = BrowserWindow.getFocusedWindow();
          if (!window || !window.webContents) {
            return;
          }

          const zoomFactor = Math.min(1.8, getZoomFactor() + 0.05);
          window.webContents.setZoomFactor(zoomFactor);

          saveZoomFactor(zoomFactor);
          trackEvent('App Menu', 'Zoom In');
        }
      },
      {
        label: 'Zoom Out',
        accelerator: 'CmdOrCtrl+-',
        click: () => {
          const window = BrowserWindow.getFocusedWindow();
          if (!window || !window.webContents) {
            return;
          }

          const zoomFactor = Math.max(0.5, getZoomFactor() - 0.05);
          window.webContents.setZoomFactor(zoomFactor);
          saveZoomFactor(zoomFactor);
          trackEvent('App Menu', 'Zoom Out');
        }
      },
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+\\',
        click: () => {
          const window = BrowserWindow.getFocusedWindow();
          if (!window || !window.webContents) {
            return;
          }

          window.webContents.send('toggle-sidebar');
          trackEvent('App Menu', 'Toggle Sidebar');
        }
      }
    ]
  };

  const windowMenu = {
    label: 'Window',
    role: 'window',
    submenu: [
      {role: 'minimize'},
      ...(isMac() ? [{role: 'close'}] : [])
    ]
  };

  const helpMenu = {
    label: 'Help',
    role: 'help',
    id: 'help',
    submenu: [
      {
        label: 'Contact Support',
        click: () => {
          trackEvent('App Menu', 'Contact');
          shell.openExternal('https://insomnia.rest/documentation/support-and-feedback/');
        }
      },
      {
        label: 'Insomnia Help',
        accelerator: 'CmdOrCtrl+?',
        click: () => {
          trackEvent('App Menu', 'Help');
          shell.openExternal('https://insomnia.rest/documentation/');
        }
      }
    ]
  };

  const developerMenu = {
    label: 'Developer',
    position: 'before=help',
    submenu: [{
      label: 'Reload',
      accelerator: 'CmdOrCtrl+Shift+R',
      click: () => mainWindow.reload()
    }, {
      label: 'Toggle DevTools',
      accelerator: 'Alt+CmdOrCtrl+I',
      click: () => mainWindow.toggleDevTools()
    }, {
      label: 'Resize to Default',
      click: () => mainWindow.setBounds({x: 100, y: 100, width: 1000, height: 480})
    }, {
      label: 'Take Screenshot',
      click: function () {
        mainWindow.capturePage(image => {
          const buffer = image.toPNG();
          const dir = app.getPath('desktop');
          fs.writeFileSync(path.join(dir, `Screenshot-${new Date()}.png`), buffer);
        });
      }
    }]
  };

  let template = [];

  template.push(applicationMenu);
  template.push(editMenu);
  template.push(viewMenu);
  template.push(windowMenu);
  template.push(helpMenu);

  if (isDevelopment() || process.env.INSOMNIA_FORCE_DEBUG) {
    template.push(developerMenu);
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  return mainWindow;
}

function showUnresponsiveModal () {
  dialog.showMessageBox({
    type: 'info',
    buttons: ['Cancel', 'Reload'],
    defaultId: 1,
    cancelId: 0,
    title: 'Unresponsive',
    message: 'Insomnia has become unresponsive. Do you want to reload?'
  }, id => {
    if (id === 1) {
      mainWindow.destroy();
      createWindow();
    }
  });
}

function trackEvent (...args) {
  const windows = BrowserWindow.getAllWindows();
  if (!windows.length || !windows[0].webContents) {
    return;
  }

  windows[0].webContents.send('analytics-track-event', args);
}

function saveBounds () {
  if (!mainWindow) {
    return;
  }

  const fullscreen = mainWindow.isFullScreen();

  // Only save the size if we're not in fullscreen
  if (!fullscreen) {
    localStorage.setItem('bounds', mainWindow.getBounds());
    localStorage.setItem('fullscreen', false);
  } else {
    localStorage.setItem('fullscreen', true);
  }
}

function getBounds () {
  let bounds = {};
  let fullscreen = false;
  try {
    bounds = localStorage.getItem('bounds', {});
    fullscreen = localStorage.getItem('fullscreen', false);
  } catch (e) {
    // This should never happen, but if it does...!
    console.error('Failed to parse window bounds', e);
  }

  return {bounds, fullscreen};
}

function saveZoomFactor (zoomFactor) {
  localStorage.setItem('zoomFactor', zoomFactor);
}

function getZoomFactor () {
  let zoomFactor = 1;
  try {
    zoomFactor = localStorage.getItem('zoomFactor', 1);
  } catch (e) {
    // This should never happen, but if it does...!
    console.error('Failed to parse zoomFactor', e);
  }

  return zoomFactor;
}

function initLocalStorage () {
  const localStoragePath = path.join(app.getPath('userData'), 'localStorage');
  localStorage = new LocalStorage(localStoragePath);
}

function initContextMenus () {
  require('electron-context-menu')({});
}
