// Set de iconos de línea, consistentes entre sí (mismo trazo/tamaño) y sin
// depender de una fuente de iconos externa ni de emoji — heredan el color
// del texto que los rodea vía stroke="currentColor".

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="6.3"/><line x1="20" y1="20" x2="15.6" y2="15.6"/>',
  wallet: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.3"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  send: '<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/><path d="M12.5 13.5 21 3"/>',
  receipt: '<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>',
  catalog: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z"/><line x1="4" y1="18" x2="20" y2="18"/>',
  finance: '<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>',
  bell: '<path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 3h16l-2-3Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  quote: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><line x1="9" y1="10.5" x2="15" y2="10.5"/><line x1="9" y1="14" x2="13" y2="14"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.8h7.2a2 2 0 0 0 2-1.8L21 8H6"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  book: '<path d="M4 5.5C4 4.67 4.67 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z"/><path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z"/>',
  inbox: '<path d="M3 12h4.5l1.5 3h6l1.5-3H21"/><path d="M5 12 6.8 5.6A2 2 0 0 1 8.7 4h6.6a2 2 0 0 1 1.9 1.6L19 12"/><path d="M3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6"/>',
  sign: '<path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M15 3v5h5"/><path d="M7.5 17.3c1-1.4 1.4-1.4 1.9 0s1-1.9 1.9-.9 1 1.4 1.9.5 1.4-1.9 1.9-.9"/>',
};

function icon(name, size) {
  const s = size || 20;
  const inner = ICON_PATHS[name] || '';
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
