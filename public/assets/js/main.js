const TAGS_API = "https://danbooru.donmai.us/tags.json";
const POSTS_API = "https://danbooru.donmai.us/posts.json";
const AUTOCOMPLETE_LIMIT = 10;
const PAGE_SIZE = 100;
const BOUNDARY_LIMIT = 200;

const CATEGORY_NAMES = {
  0:"General",
  1:"Artist",
  3:"Copyright",
  4:"Character",
  5:"Meta"
};

const CATEGORY_FIELDS = {
  "0":"tag_string_general",
  "1":"tag_string_artist",
  "3":"tag_string_copyright",
  "4":"tag_string_character",
  "5":"tag_string_meta"
};

const $ = id => document.getElementById(id);

let searchTab = "simple";
let mode = "direct";

let advancedYears = [2025];
let activeDirectYear = null;
let tableSort = {
  key:"created_at",
  direction:"asc"
};
let currentRows = [];
let localRows = [];
let currentPage = 1;
let pageLabelMode = "number";

let firstYearId = null;
let lastYearId = null;

let abortController = null;

let searchInProgress = false;

const tagFieldState = {
  character:{
    value:"",
    category:4,
    wrapperId:"characterAutocomplete",
    chipId:"characterChip",
    menuId:"characterSuggestions",
    label:"Personagem",
    suggestions:[],
    activeIndex:-1,
    controller:null,
    timer:null
  },
  copyright:{
    value:"",
    category:3,
    wrapperId:"copyrightAutocomplete",
    chipId:"copyrightChip",
    menuId:"copyrightSuggestions",
    label:"Anime / franquia / mangá",
    suggestions:[],
    activeIndex:-1,
    controller:null,
    timer:null
  }
};

function normalizeTag(value) {
  return String(value || "").trim().replace(/\s+/g, "_");
}

function getFilters() {
  const advanced = searchTab === "advanced";
  const simpleYear = Number($("year").value);
  const years = advanced
    ? [...advancedYears].sort((a,b) => a-b)
    : [simpleYear];

  return {
    year:years[0],
    years,
    character:advanced ? tagFieldState.character.value : "",
    copyright:advanced ? tagFieldState.copyright.value : "",
    category:$("category").value,
    minPosts:Math.max(0,Number($("minPosts").value || 0)),
    order:advanced ? "date_asc" : $("order").value,
    maxPosts:advanced ? Number($("maxPosts").value) : 1000,
    deprecated:advanced ? $("deprecated").value : ""
  };
}

function escapeSelectorValue(value) {
  return String(value).replaceAll('"','\\"');
}

function hasUncommittedTagText(fieldId) {
  const state = tagFieldState[fieldId];

  return (
    !state.value &&
    String($(fieldId).value || "").trim() !== ""
  );
}

function hasInvalidTagDraft() {
  return (
    hasUncommittedTagText("character") ||
    hasUncommittedTagText("copyright")
  );
}

function updateSearchButtonState() {
  $("searchBtn").disabled =
    searchInProgress ||
    hasInvalidTagDraft();
}

function hideTagSuggestions(fieldId) {
  const state = tagFieldState[fieldId];
  const menu = $(state.menuId);

  state.activeIndex = -1;
  menu.hidden = true;
  $(fieldId).setAttribute("aria-expanded","false");
}

function renderTagChip(fieldId) {
  const state = tagFieldState[fieldId];
  const wrapper = $(state.wrapperId);
  const chip = $(state.chipId);
  const input = $(fieldId);

  if (!state.value) {
    wrapper.classList.remove("has-value");
    chip.innerHTML = "";
    input.disabled = false;
    updateSearchButtonState();
    return;
  }

  wrapper.classList.add("has-value");
  input.value = "";
  input.disabled = true;

  chip.innerHTML = `
    <span class="tag-chip">
      <span class="tag-chip-name">${escapeHtml(state.value)}</span>
      <button
        type="button"
        data-remove-tag="${fieldId}"
        title="Remover ${escapeHtml(state.value)}"
        aria-label="Remover ${escapeHtml(state.value)}"
      >×</button>
    </span>
  `;

  chip
    .querySelector("[data-remove-tag]")
    .addEventListener("click", () => {
      state.value = "";
      state.suggestions = [];
      renderTagChip(fieldId);
      hideTagSuggestions(fieldId);
      $("error").textContent = "";
      input.focus();
    });

  updateSearchButtonState();
}

function selectTagSuggestion(fieldId,tag) {
  const state = tagFieldState[fieldId];

  state.value = String(tag.name || "").trim();
  state.suggestions = [];
  $("error").textContent = "";
  renderTagChip(fieldId);
  hideTagSuggestions(fieldId);
}

function renderTagSuggestions(fieldId,rows) {
  const state = tagFieldState[fieldId];
  const menu = $(state.menuId);

  state.suggestions = rows;
  state.activeIndex = -1;

  if (!rows.length) {
    menu.innerHTML =
      '<div class="tag-autocomplete-empty">Nenhuma tag encontrada.</div>';
    menu.hidden = false;
    $(fieldId).setAttribute("aria-expanded","true");
    return;
  }

  menu.innerHTML = rows.map((tag,index) => `
    <button
      type="button"
      class="tag-autocomplete-option"
      role="option"
      data-tag-index="${index}"
      aria-selected="false"
    >
      <span class="tag-autocomplete-option-name">${escapeHtml(tag.name)}</span>
      <span class="tag-autocomplete-option-count">${Number(tag.post_count || 0).toLocaleString("pt-BR")} posts</span>
    </button>
  `).join("");

  menu.querySelectorAll("[data-tag-index]").forEach(button => {
    button.addEventListener("mousedown", event => {
      event.preventDefault();
    });

    button.addEventListener("click", () => {
      const index = Number(button.dataset.tagIndex);
      const tag = state.suggestions[index];

      if (tag) {
        selectTagSuggestion(fieldId,tag);
      }
    });
  });

  menu.hidden = false;
  $(fieldId).setAttribute("aria-expanded","true");
}

function updateActiveTagSuggestion(fieldId,nextIndex) {
  const state = tagFieldState[fieldId];
  const menu = $(state.menuId);
  const buttons = [...menu.querySelectorAll("[data-tag-index]")];

  if (!buttons.length) return;

  state.activeIndex =
    (nextIndex + buttons.length) % buttons.length;

  buttons.forEach((button,index) => {
    const active = index === state.activeIndex;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",String(active));
  });

  buttons[state.activeIndex].scrollIntoView({
    block:"nearest"
  });
}

async function fetchTagSuggestions(fieldId,query) {
  const state = tagFieldState[fieldId];

  if (state.controller) {
    state.controller.abort();
  }

  state.controller = new AbortController();

  const params = new URLSearchParams();
  params.set(
    "search[name_matches]",
    `${normalizeTag(query)}*`
  );
  params.set("search[category]",String(state.category));
  params.set("search[order]","count");
  params.set("limit",String(AUTOCOMPLETE_LIMIT));

  const response = await fetch(
    TAGS_API + "?" + params.toString(),
    {
      headers:{"Accept":"application/json"},
      signal:state.controller.signal
    }
  );

  if (!response.ok) {
    throw new Error(
      `Danbooru respondeu HTTP ${response.status} ao buscar sugestões.`
    );
  }

  const data = await response.json();

  return Array.isArray(data)
    ? data.filter(tag =>
        Number(tag.category) === state.category &&
        String(tag.name || "").trim() !== ""
      )
    : [];
}

async function validateExactTag(fieldId) {
  const state = tagFieldState[fieldId];
  const input = $(fieldId);
  const normalized = normalizeTag(input.value);

  if (!normalized) {
    hideTagSuggestions(fieldId);
    return false;
  }

  if (state.controller) {
    state.controller.abort();
  }

  state.controller = new AbortController();

  const params = new URLSearchParams();
  params.set("search[name_matches]",normalized);
  params.set("search[category]",String(state.category));
  params.set("limit","20");

  try {
    const response = await fetch(
      TAGS_API + "?" + params.toString(),
      {
        headers:{"Accept":"application/json"},
        signal:state.controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `Danbooru respondeu HTTP ${response.status} ao validar a tag.`
      );
    }

    const data = await response.json();
    const exact = Array.isArray(data)
      ? data.find(tag =>
          Number(tag.category) === state.category &&
          String(tag.name || "") === normalized
        )
      : null;

    if (!exact) {
      $("error").textContent =
        `${state.label}: "${normalized}" não é uma tag válida dessa categoria no Danbooru.`;
      updateSearchButtonState();
      return false;
    }

    selectTagSuggestion(fieldId,exact);
    return true;
  } catch (error) {
    if (error.name === "AbortError") {
      return false;
    }

    $("error").textContent = error.message;
    updateSearchButtonState();
    return false;
  }
}

function scheduleTagSuggestions(fieldId) {
  const state = tagFieldState[fieldId];
  const input = $(fieldId);
  const query = String(input.value || "").trim();

  clearTimeout(state.timer);

  if (!query || state.value) {
    state.suggestions = [];
    hideTagSuggestions(fieldId);
    updateSearchButtonState();
    return;
  }

  updateSearchButtonState();

  state.timer = setTimeout(async () => {
    try {
      const rows = await fetchTagSuggestions(fieldId,query);

      if (
        String(input.value || "").trim() !== query ||
        state.value
      ) {
        return;
      }

      renderTagSuggestions(fieldId,rows);
    } catch (error) {
      if (error.name === "AbortError") return;

      hideTagSuggestions(fieldId);
      $("error").textContent = error.message;
    }
  },250);
}

function setupTagAutocomplete(fieldId) {
  const state = tagFieldState[fieldId];
  const input = $(fieldId);

  input.addEventListener("input", () => {
    state.value = "";
    $("error").textContent = "";
    scheduleTagSuggestions(fieldId);
  });

  input.addEventListener("focus", () => {
    if (
      !state.value &&
      String(input.value || "").trim()
    ) {
      scheduleTagSuggestions(fieldId);
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(
      () => hideTagSuggestions(fieldId),
      120
    );
  });

  input.addEventListener("keydown", async event => {
    const menu = $(state.menuId);
    const hasSuggestions =
      !menu.hidden &&
      state.suggestions.length > 0;

    if (event.key === "ArrowDown" && hasSuggestions) {
      event.preventDefault();
      updateActiveTagSuggestion(
        fieldId,
        state.activeIndex + 1
      );
      return;
    }

    if (event.key === "ArrowUp" && hasSuggestions) {
      event.preventDefault();
      updateActiveTagSuggestion(
        fieldId,
        state.activeIndex <= 0
          ? state.suggestions.length - 1
          : state.activeIndex - 1
      );
      return;
    }

    if (event.key === "Escape") {
      hideTagSuggestions(fieldId);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (
        hasSuggestions &&
        state.activeIndex >= 0
      ) {
        selectTagSuggestion(
          fieldId,
          state.suggestions[state.activeIndex]
        );
        return;
      }

      await validateExactTag(fieldId);
    }
  });

  $(state.wrapperId).addEventListener("click", event => {
    if (
      !event.target.closest("button") &&
      !state.value
    ) {
      input.focus();
    }
  });
}

function renderYearChips() {
  const container = $("yearChips");
  const years = [...advancedYears].sort((a,b) => a-b);

  container.innerHTML = years.map(year => `
    <span class="year-chip">
      ${year}
      <button
        type="button"
        data-remove-year="${year}"
        title="Remover ${year}"
        aria-label="Remover ${year}"
      >×</button>
    </span>
  `).join("");

  container.querySelectorAll("[data-remove-year]").forEach(button => {
    button.addEventListener("click", () => {
      const year = Number(button.dataset.removeYear);
      advancedYears = advancedYears.filter(item => item !== year);
      renderYearChips();
    });
  });
}

function addAdvancedYear() {
  const input = $("advancedYearInput");
  const year = Number(input.value);

  if (!Number.isInteger(year) || year < 2005 || year > 2100) {
    $("error").textContent = "Informe um ano válido entre 2005 e 2100.";
    return;
  }

  $("error").textContent = "";

  if (!advancedYears.includes(year)) {
    advancedYears.push(year);
    advancedYears.sort((a,b) => a-b);
  }

  input.value = "";
  renderYearChips();
}

function selectedYearRange(f) {
  const years = [...f.years].sort((a,b) => a-b);

  return {
    first:years[0],
    last:years[years.length-1],
    start:`${years[0]}-01-01`,
    end:`${years[years.length-1]}-12-31`
  };
}

function rowYear(row) {
  const date = new Date(row.created_at || 0);
  return Number.isNaN(date.getTime())
    ? null
    : date.getFullYear();
}

function isSelectedYear(row,f) {
  return f.years.includes(rowYear(row));
}

function compareValues(a,b,key) {
  let av = a?.[key];
  let bv = b?.[key];

  if (key === "created_at") {
    av = new Date(av || 0).getTime();
    bv = new Date(bv || 0).getTime();
  } else if (
    key === "id" ||
    key === "post_count" ||
    key === "association_count" ||
    key === "category"
  ) {
    av = Number(av || 0);
    bv = Number(bv || 0);
  } else if (key === "is_deprecated") {
    av = Boolean(av) ? 1 : 0;
    bv = Boolean(bv) ? 1 : 0;
  } else {
    av = String(av ?? "").toLowerCase();
    bv = String(bv ?? "").toLowerCase();
  }

  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function sortRowsByTable(rows) {
  const direction = tableSort.direction === "desc" ? -1 : 1;

  return [...rows].sort((a,b) => {
    const main = compareValues(a,b,tableSort.key) * direction;

    if (main !== 0) return main;

    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function updateSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach(th => {
    const indicator = th.querySelector(".sort-indicator");
    const active =
      searchTab === "advanced" &&
      th.dataset.sort === tableSort.key;

    th.classList.toggle("sort-active", active);

    const button = th.querySelector(".sort-button");
    if (button) {
      const label = button.querySelector("span:first-child")?.textContent || "coluna";
      button.title =
        searchTab === "advanced"
          ? `Ordenar por ${label}`
          : "";
      button.setAttribute(
        "aria-label",
        searchTab === "advanced"
          ? `Ordenar por ${label}`
          : label
      );
    }

    th.setAttribute(
      "aria-sort",
      active
        ? (tableSort.direction === "asc" ? "ascending" : "descending")
        : "none"
    );

    if (!indicator) return;

    if (searchTab !== "advanced") {
      indicator.textContent = "";
    } else if (!active) {
      indicator.textContent = "↕";
    } else {
      indicator.textContent =
        tableSort.direction === "asc"
          ? "▲"
          : "▼";
    }
  });
}

function applyTableSort() {
  if (searchTab !== "advanced") return;

  if (mode === "local") {
    localRows = sortRowsByTable(localRows);
    renderLocalPage(1);
  } else {
    const rows = sortRowsByTable(currentRows);
    renderRows(rows);
    updatePager();
  }

  updateSortHeaders();
}

function changeTableSort(key) {
  if (searchTab !== "advanced") return;

  if (tableSort.key === key) {
    tableSort.direction =
      tableSort.direction === "asc"
        ? "desc"
        : "asc";
  } else {
    tableSort.key = key;
    tableSort.direction =
      key === "post_count" ||
      key === "association_count"
        ? "desc"
        : "asc";
  }

  applyTableSort();
}

function setSearchTab(tab) {
  searchTab = tab === "advanced" ? "advanced" : "simple";

  const simple = searchTab === "simple";
  const panel = $("searchPanel");
  const associationOption = $("associationOrderOption");

  panel.classList.toggle("simple-mode", simple);
  panel.classList.toggle("advanced-mode", !simple);
  document.body.classList.toggle("advanced-search", !simple);

  $("simpleTab").classList.toggle("active", simple);
  $("advancedTab").classList.toggle("active", !simple);

  $("simpleTab").setAttribute("aria-selected", String(simple));
  $("advancedTab").setAttribute("aria-selected", String(!simple));

  associationOption.hidden = simple;
  associationOption.disabled = simple;

  if (simple && $("order").value === "association") {
    $("order").value = "date_asc";
  }

  if (simple) {
    $("tabDescription").textContent =
      "Busca simples: filtre apenas por ano, ordenação, categoria e quantidade mínima de posts.";

    $("searchHint").innerHTML =
      'Ordenação padrão: <strong>do começo do ano para o fim</strong>.';
  } else {
    if (!advancedYears.length) {
      const currentSimpleYear = Number($("year").value);
      if (Number.isInteger(currentSimpleYear)) {
        advancedYears = [currentSimpleYear];
        renderYearChips();
      }
    }

    $("tabDescription").textContent =
      "Busca avançada: combine vários anos e ordene clicando diretamente nos cabeçalhos da tabela.";

    $("searchHint").innerHTML =
      'Adicione anos com <strong>Enter</strong> ou <strong>+</strong>. ' +
      'Clique nos <strong>cabeçalhos da tabela</strong> para ordenar.';
  }

  updateSortHeaders();
}

function validateFilters(f) {
  if (hasInvalidTagDraft()) {
    throw new Error(
      "Selecione uma sugestão válida do Danbooru ou apague o texto dos campos Personagem / Anime / franquia / mangá."
    );
  }

  if (!Array.isArray(f.years) || !f.years.length) {
    throw new Error("Adicione pelo menos um ano à pesquisa.");
  }

  const invalidYear = f.years.find(
    year => !Number.isInteger(year) || year < 2005 || year > 2100
  );

  if (invalidYear !== undefined) {
    throw new Error("Informe anos válidos entre 2005 e 2100.");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function categoryName(category) {
  return CATEGORY_NAMES[category] ?? String(category ?? "—");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle:"short",
    timeStyle:"short"
  }).format(date);
}

function setProgress(show,percent=0) {
  $("progress").style.display = show ? "block" : "none";
  $("progressBar").style.width =
    Math.max(0,Math.min(100,percent)) + "%";
}

function dateYMD(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth()+1).padStart(2,"0"),
    String(date.getUTCDate()).padStart(2,"0")
  ].join("-");
}

function addDays(date,amount) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate()+amount);
  return copy;
}

function buildBaseTagParams(f) {
  const params = new URLSearchParams();

  if (mode === "direct" && activeDirectYear !== null) {
    params.set(
      "search[created_at]",
      `${activeDirectYear}-01-01..${activeDirectYear}-12-31`
    );
  } else {
    const range = selectedYearRange(f);
    params.set(
      "search[created_at]",
      `${range.start}..${range.end}`
    );
  }

  if (f.category !== "") {
    params.set("search[category]",f.category);
  }

  if (f.minPosts > 0) {
    params.set("search[post_count]",`${f.minPosts}..`);
  }

  if (f.deprecated !== "") {
    params.set("search[is_deprecated]",f.deprecated);
  }

  return params;
}

async function fetchJson(url) {
  const response = await fetch(url,{
    headers:{"Accept":"application/json"},
    signal:abortController?.signal
  });

  if (!response.ok) {
    const body = await response.text().catch(()=>"");

    throw new Error(
      `Danbooru respondeu HTTP ${response.status} ${response.statusText}` +
      (body ? "\n" + body.slice(0,500) : "")
    );
  }

  return response.json();
}

function renderRows(rows) {
  currentRows = rows;
  const tbody = $("tbody");

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="8">Nenhuma tag encontrada.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(tag => {
    const name = tag.name || "";
    const encoded = encodeURIComponent(name);
    const deprecated = Boolean(tag.is_deprecated);

    return `
      <tr>
        <td data-label="ID">${escapeHtml(tag.id)}</td>
        <td class="tag" data-label="Tag">
          <a
            href="https://danbooru.donmai.us/posts?tags=${encoded}"
            target="_blank"
            rel="noopener"
          >${escapeHtml(name)}</a>
        </td>
        <td data-label="Categoria">${escapeHtml(categoryName(tag.category))}</td>
        <td class="num" data-label="Posts">
          ${Number(tag.post_count || 0).toLocaleString("pt-BR")}
        </td>
        <td class="num" data-label="Ocorrências no filtro">
          ${Number(tag.association_count || 0).toLocaleString("pt-BR")}
        </td>
        <td data-label="Criada em">${escapeHtml(formatDate(tag.created_at))}</td>
        <td class="${deprecated ? "bad" : "ok"}" data-label="Status">
          ${deprecated ? "deprecated" : "ativa"}
        </td>
        <td data-label="Links">
          <span class="card-links">
            <a
              href="https://danbooru.donmai.us/tags/${tag.id}"
              target="_blank"
              rel="noopener"
            >tag</a>
            <span aria-hidden="true">·</span>
            <a
              href="https://danbooru.donmai.us/wiki_pages/${encoded}"
              target="_blank"
              rel="noopener"
            >wiki</a>
          </span>
        </td>
      </tr>
    `;
  }).join("");

  updateSortHeaders();
}

function sortChronological(rows) {
  return [...rows].sort((a,b) => {
    const da = new Date(a.created_at || 0).getTime();
    const db = new Date(b.created_at || 0).getTime();

    return da - db || Number(a.id || 0) - Number(b.id || 0);
  });
}

function sortLocalRows(rows,order) {
  const result = [...rows];

  if (order === "count") {
    result.sort((a,b) =>
      (b.post_count || 0) - (a.post_count || 0)
    );
  } else if (order === "association") {
    result.sort((a,b) =>
      (b.association_count || 0) - (a.association_count || 0) ||
      (b.post_count || 0) - (a.post_count || 0)
    );
  } else if (order === "name") {
    result.sort((a,b) =>
      String(a.name).localeCompare(String(b.name))
    );
  } else {
    return sortChronological(result);
  }

  return result;
}

function updatePaginationVisibility() {
  const pagination = $("pagination");

  if (!pagination) return;

  let show = false;

  if (mode === "local") {
    show = localRows.length > PAGE_SIZE;
  } else if (currentRows.length) {
    const f = getFilters();
    const hasAnotherSelectedYear =
      searchTab === "advanced" &&
      Array.isArray(f.years) &&
      f.years.length > 1;

    show =
      currentRows.length >= PAGE_SIZE ||
      hasAnotherSelectedYear ||
      pageLabelMode === "last" ||
      pageLabelMode === "near-last" ||
      currentPage > 1;
  }

  pagination.hidden = !show;
}

function updatePager() {
  if (mode === "local") {
    const total =
      Math.max(1,Math.ceil(localRows.length/PAGE_SIZE));

    currentPage =
      Math.max(1,Math.min(currentPage,total));

    $("pageStatus").textContent =
      `Página ${currentPage} de ${total}`;

    $("firstBtn").disabled = currentPage <= 1;
    $("prevBtn").disabled = currentPage <= 1;
    $("nextBtn").disabled = currentPage >= total;
    $("lastBtn").disabled = currentPage >= total;
    updatePaginationVisibility();
    return;
  }

  if (pageLabelMode === "last") {
    $("pageStatus").textContent =
      searchTab === "advanced" && activeDirectYear !== null
        ? `${activeDirectYear} · Última página`
        : "Última página";
  } else if (pageLabelMode === "near-last") {
    $("pageStatus").textContent = "Próxima do fim";
  } else {
    $("pageStatus").textContent =
      searchTab === "advanced" && activeDirectYear !== null
        ? `${activeDirectYear} · Página ${currentPage}`
        : `Página ${currentPage}`;
  }

  const ids = currentRows.map(row => Number(row.id));
  const minId = ids.length ? Math.min(...ids) : null;
  const maxId = ids.length ? Math.max(...ids) : null;

  $("firstBtn").disabled =
    !currentRows.length ||
    (firstYearId !== null && minId === firstYearId);

  $("prevBtn").disabled = $("firstBtn").disabled;

  $("lastBtn").disabled =
    !currentRows.length ||
    (lastYearId !== null && maxId === lastYearId);

  $("nextBtn").disabled = $("lastBtn").disabled;
  updatePaginationVisibility();
}

async function queryBoundaryDay(f,day) {
  const next = addDays(day,1);

  const params = buildBaseTagParams(f);

  params.set(
    "search[created_at]",
    `${dateYMD(day)}..${dateYMD(next)}`
  );

  params.set("search[order]","date");
  params.set("limit",String(BOUNDARY_LIMIT));
  params.set("page","1");

  const data =
    await fetchJson(TAGS_API + "?" + params.toString());

  return Array.isArray(data) ? data : [];
}

async function findFirstYearId() {
  if (firstYearId !== null) {
    return firstYearId;
  }

  const f = getFilters();
  validateFilters(f);

  const targetYear =
    activeDirectYear !== null
      ? activeDirectYear
      : f.year;

  let day =
    new Date(Date.UTC(targetYear,0,1));

  const end =
    new Date(Date.UTC(targetYear+1,0,1));

  let checked = 0;

  while (day < end) {
    $("status").textContent =
      `Localizando o começo de ${targetYear}: ${dateYMD(day)}…`;

    setProgress(true,Math.min(25,(checked/366)*25));

    const rows =
      await queryBoundaryDay(f,day);

    if (rows.length) {
      let minId =
        Math.min(...rows.map(row => Number(row.id)));

      /*
        Caso excepcional: se houver mais resultados nesse dia
        do que o limite, continuamos para IDs menores dentro
        do MESMO intervalo até encontrar o começo do dia.
      */
      if (rows.length >= BOUNDARY_LIMIT) {
        let cursorId = minId;

        while (true) {
          const nextDay = addDays(day,1);
          const params = buildBaseTagParams(f);

          params.set(
            "search[created_at]",
            `${dateYMD(day)}..${dateYMD(nextDay)}`
          );

          params.set("limit",String(BOUNDARY_LIMIT));
          params.set("page","b" + cursorId);

          const more =
            await fetchJson(
              TAGS_API + "?" + params.toString()
            );

          if (!Array.isArray(more) || !more.length) {
            break;
          }

          minId =
            Math.min(
              minId,
              ...more.map(row => Number(row.id))
            );

          if (more.length < BOUNDARY_LIMIT) {
            break;
          }

          cursorId =
            Math.min(...more.map(row => Number(row.id)));
        }
      }

      firstYearId = minId;
      return firstYearId;
    }

    day = addDays(day,1);
    checked++;
  }

  return null;
}

async function findLastYearId() {
  if (lastYearId !== null) {
    return lastYearId;
  }

  const f = getFilters();
  validateFilters(f);

  const targetYear =
    activeDirectYear !== null
      ? activeDirectYear
      : f.year;

  let day =
    new Date(Date.UTC(targetYear,11,31));

  const start =
    new Date(Date.UTC(targetYear,0,1));

  let checked = 0;

  while (day >= start) {
    $("status").textContent =
      `Localizando o fim de ${targetYear}: ${dateYMD(day)}…`;

    setProgress(true,75 + Math.min(25,(checked/366)*25));

    const rows =
      await queryBoundaryDay(f,day);

    if (rows.length) {
      lastYearId =
        Math.max(...rows.map(row => Number(row.id)));

      return lastYearId;
    }

    day = addDays(day,-1);
    checked++;
  }

  return null;
}

async function fetchCursorPage(cursor) {
  const f = getFilters();
  const params = buildBaseTagParams(f);

  params.set("limit",String(PAGE_SIZE));
  params.set("page",cursor);

  const data =
    await fetchJson(TAGS_API + "?" + params.toString());

  const rows =
    Array.isArray(data)
      ? data.map(tag => ({
          ...tag,
          association_count:0
        }))
      : [];

  return sortChronological(rows);
}

async function loadFirstDirect() {
  mode = "direct";
  pageLabelMode = "number";
  currentPage = 1;

  const firstId =
    await findFirstYearId();

  if (firstId === null) {
    renderRows([]);
    $("status").textContent =
      "Nenhuma tag encontrada nesse ano.";
    setProgress(false);
    updatePager();
    return;
  }

  const rows =
    await fetchCursorPage("a" + Math.max(0,firstId-1));

  renderRows(rows);

  $("status").textContent =
    `${rows.length} tag(s) · ${activeDirectYear ?? getFilters().year}.`;

  $("scanInfo").textContent =
    rows.length
      ? `${formatDate(rows[0].created_at)} → ${formatDate(rows[rows.length-1].created_at)}`
      : "";

  setProgress(false);
  updatePager();
}

async function loadLastDirect() {
  mode = "direct";

  const lastId =
    await findLastYearId();

  if (lastId === null) {
    renderRows([]);
    $("status").textContent =
      "Nenhuma tag encontrada nesse ano.";
    setProgress(false);
    updatePager();
    return;
  }

  const rows =
    await fetchCursorPage("b" + (lastId+1));

  pageLabelMode = "last";
  renderRows(rows);

  $("status").textContent =
    `${rows.length} tag(s) · fim de ${activeDirectYear ?? getFilters().year}.`;

  $("scanInfo").textContent =
    rows.length
      ? `${formatDate(rows[0].created_at)} → ${formatDate(rows[rows.length-1].created_at)}`
      : "";

  setProgress(false);
  updatePager();
}

async function loadNextDirect() {
  if (!currentRows.length) return;

  const maxId =
    Math.max(...currentRows.map(row => Number(row.id)));

  const rows =
    await fetchCursorPage("a" + maxId);

  if (!rows.length) {
    lastYearId = maxId;

    if (searchTab === "advanced") {
      const years = getFilters().years;
      const index = years.indexOf(activeDirectYear);

      if (index >= 0 && index < years.length - 1) {
        activeDirectYear = years[index + 1];
        firstYearId = null;
        lastYearId = null;
        pageLabelMode = "number";
        currentPage++;
        await loadFirstDirect();
        return;
      }
    }

    updatePager();
    return;
  }

  pageLabelMode =
    lastYearId !== null &&
    Math.max(...rows.map(row => Number(row.id))) === lastYearId
      ? "last"
      : "number";

  if (pageLabelMode === "number") {
    currentPage++;
  }

  renderRows(rows);

  $("status").textContent =
    `${rows.length} tag(s) nesta página.`;

  $("scanInfo").textContent =
    `${formatDate(rows[0].created_at)} → ${formatDate(rows[rows.length-1].created_at)}`;

  updatePager();
}

async function loadPrevDirect() {
  if (!currentRows.length) return;

  const minId =
    Math.min(...currentRows.map(row => Number(row.id)));

  const rows =
    await fetchCursorPage("b" + minId);

  if (!rows.length) {
    if (searchTab === "advanced") {
      const years = getFilters().years;
      const index = years.indexOf(activeDirectYear);

      if (index > 0) {
        activeDirectYear = years[index - 1];
        firstYearId = null;
        lastYearId = null;
        await loadLastDirect();
        return;
      }
    }

    updatePager();
    return;
  }

  if (pageLabelMode === "last") {
    pageLabelMode = "near-last";
  } else if (pageLabelMode === "near-last") {
    pageLabelMode = "near-last";
  } else {
    currentPage = Math.max(1,currentPage-1);
  }

  if (
    firstYearId !== null &&
    Math.min(...rows.map(row => Number(row.id))) === firstYearId
  ) {
    pageLabelMode = "number";
    currentPage = 1;
  }

  renderRows(rows);

  $("status").textContent =
    `${rows.length} tag(s) nesta página.`;

  $("scanInfo").textContent =
    `${formatDate(rows[0].created_at)} → ${formatDate(rows[rows.length-1].created_at)}`;

  updatePager();
}

function getPostSearchTags(f) {
  return [f.character,f.copyright]
    .filter(Boolean)
    .join(" ");
}

function getPostTagsByCategory(post,category) {
  if (category === "") {
    return Object.values(CATEGORY_FIELDS)
      .flatMap(field =>
        String(post[field] || "")
          .split(/\s+/)
          .filter(Boolean)
      );
  }

  const field = CATEGORY_FIELDS[category];

  return String(post[field] || "")
    .split(/\s+/)
    .filter(Boolean);
}

async function searchRelated() {
  const f = getFilters();
  validateFilters(f);

  mode = "local";
  currentPage = 1;
  pageLabelMode = "number";

  const postTags =
    getPostSearchTags(f);

  const occurrences =
    new Map();

  let scanned = 0;
  let postPage = 1;

  setProgress(true,0);

  while (scanned < f.maxPosts) {
    const limit =
      Math.min(200,f.maxPosts-scanned);

    const params =
      new URLSearchParams();

    params.set("limit",String(limit));
    params.set("page",String(postPage));
    params.set("tags",postTags);

    $("status").textContent =
      "Analisando posts do personagem/franquia…";

    $("scanInfo").textContent =
      `${scanned.toLocaleString("pt-BR")} / ${f.maxPosts.toLocaleString("pt-BR")} posts`;

    setProgress(
      true,
      (scanned/f.maxPosts)*55
    );

    const posts =
      await fetchJson(
        POSTS_API + "?" + params.toString()
      );

    if (!Array.isArray(posts) || !posts.length) {
      break;
    }

    for (const post of posts) {
      for (
        const tagName of
        getPostTagsByCategory(post,f.category)
      ) {
        occurrences.set(
          tagName,
          (occurrences.get(tagName) || 0)+1
        );
      }
    }

    scanned += posts.length;
    postPage++;

    if (posts.length < limit) {
      break;
    }
  }

  const names =
    [...occurrences.keys()];

  $("scanInfo").textContent =
    `${scanned.toLocaleString("pt-BR")} posts · ${names.length.toLocaleString("pt-BR")} tags distintas`;

  if (!names.length) {
    localRows = [];
    renderLocalPage(1);
    setProgress(false);
    return;
  }

  const result = [];
  const chunkSize = 50;

  for (
    let i=0;
    i<names.length;
    i+=chunkSize
  ) {
    const chunk =
      names.slice(i,i+chunkSize);

    const params =
      new URLSearchParams();

    params.set(
      "search[name_normalize]",
      chunk.join(",")
    );

    const range = selectedYearRange(f);

    params.set(
      "search[created_at]",
      `${range.start}..${range.end}`
    );

    params.set("limit","200");

    if (f.category !== "") {
      params.set(
        "search[category]",
        f.category
      );
    }

    if (f.minPosts > 0) {
      params.set(
        "search[post_count]",
        `${f.minPosts}..`
      );
    }

    if (f.deprecated !== "") {
      params.set(
        "search[is_deprecated]",
        f.deprecated
      );
    }

    $("status").textContent =
      `Verificando criação das tags… ${Math.min(i+chunkSize,names.length)} / ${names.length}`;

    setProgress(
      true,
      55 + (i/names.length)*45
    );

    const tags =
      await fetchJson(
        TAGS_API + "?" + params.toString()
      );

    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (!isSelectedYear(tag,f)) {
          continue;
        }

        result.push({
          ...tag,
          association_count:
            occurrences.get(tag.name) || 0
        });
      }
    }
  }

  localRows =
    searchTab === "advanced"
      ? sortRowsByTable(result)
      : sortLocalRows(result,f.order);

  setProgress(false);
  renderLocalPage(1);
}

function renderLocalPage(page) {
  const total =
    Math.max(
      1,
      Math.ceil(localRows.length/PAGE_SIZE)
    );

  currentPage =
    Math.max(
      1,
      Math.min(Number(page) || 1,total)
    );

  const start =
    (currentPage-1)*PAGE_SIZE;

  const rows =
    localRows.slice(
      start,
      start+PAGE_SIZE
    );

  renderRows(rows);

  $("status").textContent =
    `${localRows.length.toLocaleString("pt-BR")} tag(s) encontradas · ${rows.length} nesta página.`;

  if (rows.length) {
    $("scanInfo").textContent =
      `${formatDate(rows[0].created_at)} → ${formatDate(rows[rows.length-1].created_at)}`;
  }

  updatePager();
}

async function loadNumberedDirect(page) {
  const f = getFilters();
  const params = buildBaseTagParams(f);

  params.set("limit",String(PAGE_SIZE));
  params.set("page",String(page));

  if (f.order === "count") {
    params.set("search[order]","count");
  } else if (f.order === "name") {
    params.set("search[order]","name");
  } else {
    params.set("search[order]","date");
  }

  const data =
    await fetchJson(
      TAGS_API + "?" + params.toString()
    );

  mode = "direct";
  currentPage = page;
  pageLabelMode = "number";

  const rows =
    Array.isArray(data)
      ? data.map(tag => ({
          ...tag,
          association_count:0
        }))
      : [];

  renderRows(rows);

  $("status").textContent =
    `${rows.length} tag(s) nesta página.`;

  $("scanInfo").textContent =
    "Ordenação não cronológica";

  $("pageStatus").textContent =
    `Página ${currentPage}`;

  $("firstBtn").disabled =
    currentPage <= 1;

  $("prevBtn").disabled =
    currentPage <= 1;

  $("nextBtn").disabled =
    rows.length < PAGE_SIZE;

  /*
    O último resultado global em ordenação por count/name
    exigiria descobrir a quantidade total/offset.
    Mantemos desabilitado para não recriar o timeout.
  */
  $("lastBtn").disabled = true;
  updatePaginationVisibility();
}

async function search() {
  if (abortController) {
    abortController.abort();
  }

  abortController =
    new AbortController();

  firstYearId = null;
  lastYearId = null;
  currentRows = [];
  localRows = [];
  currentPage = 1;
  pageLabelMode = "number";

  $("error").textContent = "";
  $("pagination").hidden = true;
  searchInProgress = true;
  updateSearchButtonState();
  $("csvBtn").disabled = true;
  $("firstBtn").disabled = true;
  $("prevBtn").disabled = true;
  $("nextBtn").disabled = true;
  $("lastBtn").disabled = true;

  try {
    const f = getFilters();
    validateFilters(f);

    if (f.character || f.copyright) {
      activeDirectYear = null;
      await searchRelated();
    } else if (searchTab === "advanced") {
      activeDirectYear = f.years[0];
      await loadFirstDirect();
    } else if (f.order === "date_asc") {
      activeDirectYear = f.year;
      await loadFirstDirect();
    } else {
      setProgress(false);
      await loadNumberedDirect(1);
    }

    $("csvBtn").disabled =
      mode === "local"
        ? localRows.length === 0
        : currentRows.length === 0;

  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    setProgress(false);

    $("status").textContent =
      "Falha ao consultar.";

    $("error").textContent =
      error.message +
      "\n\nA busca foi interrompida sem tentar páginas altas do Danbooru.";
  } finally {
    searchInProgress = false;
    updateSearchButtonState();
  }
}

$("yearInputShell").addEventListener("click", event => {
  if (!event.target.closest("button")) {
    $("advancedYearInput").focus();
  }
});

$("addYearBtn").addEventListener("click", addAdvancedYear);

$("advancedYearInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    addAdvancedYear();
  }
});

document.querySelectorAll(".sort-button").forEach(button => {
  button.addEventListener("click", () => {
    if (searchTab !== "advanced") return;
    changeTableSort(button.dataset.sortKey);
  });
});

$("simpleTab").addEventListener("click", () => {
  setupTagAutocomplete("character");
setupTagAutocomplete("copyright");
renderTagChip("character");
renderTagChip("copyright");
updateSearchButtonState();

advancedYears = [Number($("year").value) || 2025];
renderYearChips();
setSearchTab("simple");
updateSortHeaders();
});

$("advancedTab").addEventListener("click", () => {
  setSearchTab("advanced");
});

$("searchBtn").addEventListener(
  "click",
  search
);

$("firstBtn").addEventListener(
  "click",
  async () => {
    $("error").textContent = "";

    try {
      if (mode === "local") {
        renderLocalPage(1);
      } else if (searchTab === "advanced") {
        const years = getFilters().years;
        activeDirectYear = years[0];
        firstYearId = null;
        lastYearId = null;
        currentPage = 1;
        pageLabelMode = "number";
        await loadFirstDirect();
      } else if (getFilters().order === "date_asc") {
        await loadFirstDirect();
      } else {
        await loadNumberedDirect(1);
      }
    } catch (error) {
      $("error").textContent =
        error.message;
    }
  }
);

$("lastBtn").addEventListener(
  "click",
  async () => {
    $("error").textContent = "";

    try {
      if (mode === "local") {
        const total =
          Math.max(
            1,
            Math.ceil(localRows.length/PAGE_SIZE)
          );

        renderLocalPage(total);
      } else if (searchTab === "advanced") {
        const years = getFilters().years;
        activeDirectYear = years[years.length - 1];
        firstYearId = null;
        lastYearId = null;
        await loadLastDirect();
      } else if (
        getFilters().order === "date_asc"
      ) {
        await loadLastDirect();
      }
    } catch (error) {
      $("error").textContent =
        error.message;
    }
  }
);

$("nextBtn").addEventListener(
  "click",
  async () => {
    $("error").textContent = "";

    try {
      if (mode === "local") {
        renderLocalPage(currentPage+1);
      } else if (
        getFilters().order === "date_asc"
      ) {
        await loadNextDirect();
      } else {
        await loadNumberedDirect(
          currentPage+1
        );
      }
    } catch (error) {
      $("error").textContent =
        error.message;
    }
  }
);

$("prevBtn").addEventListener(
  "click",
  async () => {
    $("error").textContent = "";

    try {
      if (mode === "local") {
        renderLocalPage(currentPage-1);
      } else if (
        getFilters().order === "date_asc"
      ) {
        await loadPrevDirect();
      } else {
        await loadNumberedDirect(
          Math.max(1,currentPage-1)
        );
      }
    } catch (error) {
      $("error").textContent =
        error.message;
    }
  }
);

$("csvBtn").addEventListener(
  "click",
  () => {
    const rows =
      mode === "local"
        ? localRows
        : currentRows;

    if (!rows.length) return;

    const csvEscape =
      value =>
        '"' +
        String(value ?? "")
          .replaceAll('"','""') +
        '"';

    const lines = [[
      "id",
      "name",
      "category",
      "post_count",
      "association_count",
      "created_at",
      "is_deprecated"
    ].join(";")];

    for (const tag of rows) {
      lines.push([
        tag.id,
        tag.name,
        categoryName(tag.category),
        tag.post_count,
        tag.association_count || 0,
        tag.created_at,
        tag.is_deprecated
      ].map(csvEscape).join(";"));
    }

    const blob =
      new Blob(
        ["\uFEFF" + lines.join("\n")],
        {type:"text/csv;charset=utf-8"}
      );

    const a =
      document.createElement("a");

    a.href =
      URL.createObjectURL(blob);

    a.download =
      `danbooru-tags-${$("year").value}.csv`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(
      () => URL.revokeObjectURL(a.href),
      1000
    );
  }
);

for (const id of [
  "year",
  "category",
  "minPosts",
  "order",
  "maxPosts",
  "deprecated"
]) {
  $(id).addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        search();
      }
    }
  );
}

advancedYears = [Number($("year").value) || 2025];
renderYearChips();
setSearchTab("simple");
updateSortHeaders();
