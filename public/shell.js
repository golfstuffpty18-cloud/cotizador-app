// Inyecta topbar + sidebar alrededor de .content — evita repetir el mismo
// bloque de HTML en cada una de las páginas del sitio. GS Technologies tiene
// marca fija (logo real ya usado en los PDF/Excel de cotización);
// cotizador-multiempresa usa su propia versión de este archivo que resuelve
// la marca por empresa vía /api/company.

const BRAND = {
  name: 'GS Technologies',
  logo: '/assets/logo.png',
};

const USER = { name: 'GS Technologies', role: 'Administrador' };

const NAV_ITEMS = [
  { href: '/index.html', icon: 'quote', label: 'Cotización en línea' },
  { href: '/compra-menor.html', icon: 'cart', label: 'Compra Menor' },
  { href: '/programadas.html', icon: 'calendar', label: 'Programadas' },
  { href: '/enviadas.html', icon: 'send', label: 'Enviadas' },
  { href: '/directo.html', icon: 'bolt', label: 'Directas' },
  { href: '/catalog.html', icon: 'book', label: 'Catálogo' },
  { href: '/finanzas.html', icon: 'finance', label: 'Finanzas' },
];

function currentPath() {
  const p = location.pathname;
  return p === '/' ? '/index.html' : p;
}

function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function renderShell(meta) {
  const shellEl = document.getElementById('app-shell');
  const contentEl = document.querySelector('.content');
  if (!shellEl || !contentEl) return;

  const here = currentPath();

  const topbar = document.createElement('header');
  topbar.className = 'topbar';
  topbar.innerHTML = `
    <div class="topbar-brand">
      <img src="${BRAND.logo}" alt="">
      <span class="topbar-brand-name">${BRAND.name}</span>
    </div>
    <div class="topbar-search">
      <span class="topbar-search-icon">${icon('search', 16)}</span>
      <input type="search" id="globalSearchInput" placeholder="Buscar cotizaciones, productos, proveedores...">
      <span class="topbar-search-kbd">⌘K</span>
    </div>
    <button class="topbar-bell" id="enableBtn" title="Notificaciones">${icon('bell', 18)}</button>
    <div class="topbar-user">
      <div class="topbar-avatar">${initial(USER.name)}</div>
      <div>
        <div class="topbar-user-name">${USER.name}</div>
        <div class="topbar-user-role">${USER.role}</div>
      </div>
    </div>
  `;

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  const nav = document.createElement('nav');
  nav.className = 'sidebar-nav';
  nav.innerHTML = NAV_ITEMS.map(item => `
    <a class="sidebar-link ${item.href === here ? 'active' : ''}" href="${item.href}">
      <span class="icon">${icon(item.icon, 17)}</span><span>${item.label}</span>
    </a>
  `).join('');
  sidebar.appendChild(nav);

  const appBody = document.createElement('div');
  appBody.className = 'app-body';
  appBody.appendChild(sidebar);
  appBody.appendChild(contentEl);

  shellEl.replaceWith(topbar, appBody);

  if (meta && (meta.title || meta.subtitle)) {
    const greeting = document.createElement('div');
    greeting.innerHTML = `
      ${meta.title ? `<h1 class="page-greeting">${meta.title}</h1>` : ''}
      ${meta.subtitle ? `<p class="page-subtitle">${meta.subtitle}</p>` : ''}
    `;
    contentEl.prepend(...greeting.children);
  }
}

renderShell(window.PAGE_META || {});

// Rellena cualquier [data-icon] que quede en el marcado propio de la página
// (botones, ilustraciones) — un solo lugar en vez de repetir esto en cada
// script de página.
document.querySelectorAll('[data-icon]').forEach(el => {
  const size = Number(el.dataset.iconSize) || 16;
  el.innerHTML = icon(el.dataset.icon, size) + el.innerHTML;
});
