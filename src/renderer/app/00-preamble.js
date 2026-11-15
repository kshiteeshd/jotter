'use strict';

/*
  Jotter editor: the screens, the page, input and commands. Geometry lives in ink.js, the file model in
  model.js, cover artwork in covers.js and small interface helpers in ui.js.
*/

const api = window.jotter;
const { $, flash, ask, showError, closePopovers, openPopover, anyPopoverOpen, setSeg, bindSeg, timeAgo, plural } = UI;
const { W, H, r1 } = Ink;

const SCALE = 2; // canvas backing-store scale, keeps ink sharp when zoomed
const MAX_PAGED = 40; // sheets
const MAX_INFINITE = 400;
const ROOM = 700; // blank space kept below the view/content on infinite pages
const AUTOSAVE_DELAY = 1500;
const MAX_IMAGE = 1600; // larger pictures are scaled down to this many pixels on their long side
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const el = {
  editor: $('editor'),
  sheet: $('sheet'),
  sheetWrap: $('sheet-wrap'),
  workspace: $('workspace'),
  inkLayer: $('ink-layer'),
  live: $('live'),
  liveGroup: $('live-group'),
  lassoPath: $('lasso-path'),
  breaks: $('breaks'),
  sectionList: $('section-list'),
  pageList: $('page-list'),
  pageTitle: $('page-title'),
  nbName: $('nb-name'),
  size: $('size'),
  sizeValue: $('size-value'),
  sizeDot: $('size-dot'),
  swatches: $('swatches'),
  customColor: $('custom-color'),
  blockStyle: $('block-style'),
  ring: $('ring'),
  measure: $('measure'),
  statusPage: $('status-page'),
  saveState: $('save-state'),
  zoomValue: $('zoom-value'),
  toolOptions: $('tool-options'),
  pageMenu: $('page-menu'),
  templatesMenu: $('templates-menu'),
  searchPanel: $('search-panel'),
  searchInput: $('search-input'),
  searchResults: $('search-results'),
  sel: $('sel'),
  selBar: $('sel-bar'),
  imgBar: $('img-bar'),
  tboxHandle: $('tbox-handle'),
  home: $('home'),
};

const state = {
  nb: null,
  path: null,
  untitledName: '', // name given in the app before the notebook has a file
  dirty: false,
  changes: 0, // goes up on every change, so a save can tell whether newer edits arrived meanwhile
  saving: false,
  forceSnapshot: false,
  secIdx: 0,
  pageIdx: 0,
  view: 'home',
  tool: 'text',
  zoom: 1,
  fullscreen: false,
  version: '',
  settings: { theme: 'system', uiScale: 1, autosave: true, sidebar: true, paperColor: 'white', eraserMode: 'rub', defaultCover: 'kolam', defaultPaper: 'plain', defaultMode: 'paged', penOnly: false, historyLimit: 30 },
  tools: {
    text: { color: '#1f1b18' },
    pen: { color: '#1f1b18', size: 3 },
    marker: { color: '#facc15', size: 18 },
    eraser: { size: 24 },
    shape: { color: '#1f1b18', size: 3, kind: 'rect' },
    select: {},
  },
};

let sent = Model.newSent(); // which pages and images the main process already holds
const inkHistory = new Map(); // page id -> { undo: [], redo: [] } of { before, after } stroke lists
const tiles = new Map(); // sheet index -> canvas (only sheets near the viewport exist)
let busy = false; // a modal flow (dialogs, saving) is in progress

