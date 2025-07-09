// script.js

/**
 * Custom Interactive Tracker
 * Features:
 * - Dynamic tracker table with editable headers and names
 * - Fixed sticky columns (Names, Penalty)
 * - Cell selection (single/multi with long-press support)
 * - Formatting marks and background colors
 * - Penalty card cycling with 2 slots per cell
 * - Undo/Redo stack for all changes
 * - Multiple charts management with localStorage persistence
 * - Snapshot generation and preview modal
 * - Fully responsive and mobile-friendly
 */

(() => {
  "use strict";

  // Constants for marks and backgrounds
  const MARKS = {
    tick: "✅",
    cross: "❌",
    question: "❓",
  };

  const BG_CLASSES = {
    lightgreen: "bg-lightgreen",
    yellow: "bg-yellow",
    orange: "bg-orange",
    darkred: "bg-darkred",
    diagonal: "bg-diagonal-lines",
  };

  // Penalty card states cycle
  const PENALTY_STATES = ["empty", "yellow", "orange", "red"];

  // DOM Elements
  const trackerTable = document.getElementById("trackerTable");
  const theadRow = trackerTable.querySelector("thead tr");
  const tbody = trackerTable.querySelector("tbody");

  const newChartBtn = document.getElementById("newChartBtn");
  const saveChartBtn = document.getElementById("saveChartBtn");
  const deleteChartBtn = document.getElementById("deleteChartBtn");
  const chartSelector = document.getElementById("chartSelector");

  const selectionModeRadios = document.querySelectorAll(
    'input[name="selectionMode"]'
  );
  const formatButtons = document.querySelectorAll(".format-btn");

  const selectColumnBtn = document.getElementById("selectColumnBtn");
  const clearSelectionBtn = document.getElementById("clearSelectionBtn");

  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");

  const snapshotBtn = document.getElementById("snapshotBtn");
  const snapshotModal = document.getElementById("snapshotModal");
  const snapshotCanvas = document.getElementById("snapshotCanvas");
  const downloadSnapshotBtn = document.getElementById("downloadSnapshotBtn");
  const closeSnapshotBtn = document.getElementById("closeSnapshotBtn");

  // State
  let charts = {}; // { chartId: chartData }
  let currentChartId = null;
  let selectionMode = "single"; // 'single' or 'multi'
  let selectedCells = new Set(); // Set of cell keys "r-c"
  let undoStack = [];
  let redoStack = [];
  let longPressTimer = null;
  let longPressDuration = 400; // ms for mobile long press

  // Default initial chart data
  const DEFAULT_COLS = ["Column 1", "Column 2", "Column 3"];
  const DEFAULT_ROWS = [
    { name: "Player 1", penalty: ["empty", "empty"] },
    { name: "Player 2", penalty: ["empty", "empty"] },
    { name: "Player 3", penalty: ["empty", "empty"] },
  ];

  // Helper: Generate unique ID for chart
  function generateChartId() {
    return "chart-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  }

  // Helper: Save all charts to localStorage
  function saveChartsToStorage() {
    localStorage.setItem("trackerCharts", JSON.stringify(charts));
  }

  // Helper: Load charts from localStorage
  function loadChartsFromStorage() {
    const saved = localStorage.getItem("trackerCharts");
    if (saved) {
      try {
        charts = JSON.parse(saved);
      } catch {
        charts = {};
      }
    }
  }

  // Helper: Save current chart state to charts object and localStorage
  function saveCurrentChart() {
    if (!currentChartId) return;
    const chartData = serializeCurrentChart();
    charts[currentChartId] = chartData;
    saveChartsToStorage();
    updateChartSelector();
  }

  // Helper: Serialize current chart state from DOM
  function serializeCurrentChart() {
    // Headers (excluding fixed Names and Penalty)
    const headers = [];
    const ths = Array.from(
      theadRow.querySelectorAll("th:not(.names-col):not(.penalty-col)")
    );
    for (const th of ths) {
      headers.push(th.textContent.trim());
    }

    // Rows data
    const rows = [];
    const trs = Array.from(tbody.querySelectorAll("tr"));
    for (let r = 0; r < trs.length; r++) {
      const tr = trs[r];
      const nameCell = tr.querySelector(".names-col");
      const penaltyCell = tr.querySelector(".penalty-col");
      const penaltySlots = Array.from(
        penaltyCell.querySelectorAll(".card-slot")
      ).map((slot) => {
        if (slot.classList.contains("card-yellow")) return "yellow";
        if (slot.classList.contains("card-orange")) return "orange";
        if (slot.classList.contains("card-red")) return "red";
        return "empty";
      });

      // Data cells (excluding names and penalty)
      const dataCells = Array.from(
        tr.querySelectorAll("td:not(.names-col):not(.penalty-col)")
      ).map((td) => {
        // Serialize marks and backgrounds
        const markSpan = td.querySelector(".cell-mark");
        const mark = markSpan ? markSpan.textContent : null;

        const bgClass = Object.values(BG_CLASSES).find((cls) =>
          td.classList.contains(cls)
        );

        return {
          mark,
          bgClass: bgClass || null,
        };
      });

      rows.push({
        name: nameCell.textContent.trim(),
        penalty: penaltySlots,
        data: dataCells,
      });
    }

    // Chart name (stored in charts object)
    const chartName = charts[currentChartId]?.name || "Untitled Chart";

    return {
      name: chartName,
      headers,
      rows,
    };
  }

  // Helper: Deserialize chart data and render in DOM
  function loadChart(chartId) {
    if (!charts[chartId]) return;
    currentChartId = chartId;
    clearSelection();
    undoStack = [];
    redoStack = [];

    const chart = charts[chartId];

    // Set chart name in selector option text
    updateChartSelector(chartId);

    // Clear existing headers except fixed
    const fixedHeaders = theadRow.querySelectorAll(
      ".names-col, .penalty-col"
    );
    theadRow.innerHTML = "";
    fixedHeaders.forEach((th) => theadRow.appendChild(th));

    // Add dynamic headers
    for (const headerText of chart.headers) {
      const th = document.createElement("th");
      th.contentEditable = "true";
      th.classList.add("dynamic-header");
      th.setAttribute("aria-label", `Header: ${headerText}`);
      th.textContent = headerText;
      theadRow.appendChild(th);
    }

    // Clear tbody
    tbody.innerHTML = "";

    // Add rows
    for (const rowData of chart.rows) {
      const tr = document.createElement("tr");

      // Names column (editable)
      const nameTd = document.createElement("td");
      nameTd.classList.add("names-col");
      nameTd.contentEditable = "true";
      nameTd.textContent = rowData.name;
      nameTd.setAttribute("aria-label", `Name: ${rowData.name}`);
      tr.appendChild(nameTd);

      // Penalty column (2 card slots)
      const penaltyTd = document.createElement("td");
      penaltyTd.classList.add("penalty-col", "penalty-cell");
      penaltyTd.setAttribute("aria-label", `Penalty cards for ${rowData.name}`);
      for (let i = 0; i < 2; i++) {
        const slot = document.createElement("div");
        slot.classList.add("card-slot");
        const state = rowData.penalty[i] || "empty";
        if (state !== "empty") {
          slot.classList.add(`card-${state}`);
        }
        slot.dataset.slotIndex = i;
        penaltyTd.appendChild(slot);
      }
      tr.appendChild(penaltyTd);

      // Data cells (non-editable)
      for (const cellData of rowData.data) {
        const td = document.createElement("td");
        td.setAttribute("aria-label", "Data cell");
        td.tabIndex = 0; // make focusable for keyboard
        td.classList.add("data-cell");

        // Add mark span if present
        if (cellData.mark) {
          const markSpan = document.createElement("span");
          markSpan.classList.add("cell-mark");
          markSpan.textContent = cellData.mark;
          td.appendChild(markSpan);
        }

        // Add background class if present
        if (cellData.bgClass) {
          td.classList.add(cellData.bgClass);
        }

        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    // Attach event listeners for new elements
    attachTableEventListeners();

    updateUndoRedoButtons();
  }

  // Update chart selector dropdown options
  function updateChartSelector(selectedId) {
    chartSelector.innerHTML = "";
    // Sort charts by most recent (descending by timestamp in id)
    const sortedCharts = Object.entries(charts).sort((a, b) => {
      const tA = parseInt(a[0].split("-")[1]) || 0;
      const tB = parseInt(b[0].split("-")[1]) || 0;
      return tB - tA;
    });

    for (const [id, chart] of sortedCharts) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = chart.name || "Untitled Chart";
      if (id === selectedId) option.selected = true;
      chartSelector.appendChild(option);
    }

    if (!selectedId && sortedCharts.length > 0) {
      currentChartId = sortedCharts[0][0];
      loadChart(currentChartId);
    }
  }

  // Create a new empty chart with default data
  function createNewChart() {
    const id = generateChartId();
    const newChart = {
      name: `Chart ${Object.keys(charts).length + 1}`,
      headers: [...DEFAULT_COLS],
      rows: DEFAULT_ROWS.map((r) => ({
        name: r.name,
        penalty: [...r.penalty],
        data: DEFAULT_COLS.map(() => ({ mark: null, bgClass: null })),
      })),
    };
    charts[id] = newChart;
    saveChartsToStorage();
    updateChartSelector(id);
    loadChart(id);
    pushUndoState(); // initial state
  }

  // Attach event listeners to table cells for selection and interaction
  function attachTableEventListeners() {
    // Remove previous listeners to avoid duplicates
    tbody.querySelectorAll("td").forEach((td) => {
      td.onmousedown = null;
      td.ontouchstart = null;
      td.ontouchend = null;
      td.onclick = null;
      td.onkeydown = null;
    });

    // Editable headers and names: listen for input to save changes
    theadRow.querySelectorAll("th[contenteditable=true]").forEach((th) => {
      th.oninput = () => {
        pushUndoState();
        saveCurrentChart();
      };
    });
    tbody.querySelectorAll("td.names-col[contenteditable=true]").forEach((td) => {
      td.oninput = () => {
        pushUndoState();
        saveCurrentChart();
      };
    });

    // Data cells selection & formatting
    tbody.querySelectorAll("td.data-cell").forEach((td) => {
      const cellKey = getCellKey(td);

      // Mouse click selection
      td.onclick = (e) => {
        e.preventDefault();
        if (selectionMode === "single") {
          clearSelection();
          selectCell(td);
        } else {
          toggleCellSelection(td);
        }
      };

      // Keyboard support: Enter or Space select
      td.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selectionMode === "single") {
            clearSelection();
            selectCell(td);
          } else {
            toggleCellSelection(td);
          }
        }
      };

      // Touch long-press for multi-select (mobile)
      td.ontouchstart = (e) => {
        if (selectionMode === "multi") {
          longPressTimer = setTimeout(() => {
            toggleCellSelection(td);
            longPressTimer = null;
          }, longPressDuration);
        }
      };
      td.ontouchend = (e) => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          // Treat as normal tap: select single cell or toggle
          if (selectionMode === "single") {
            clearSelection();
            selectCell(td);
          } else {
            toggleCellSelection(td);
          }
        }
      };
    });

    // Penalty card slots cycling
    tbody.querySelectorAll(".penalty-cell").forEach((penaltyCell) => {
      penaltyCell.onclick = (e) => {
        const slot = e.target.closest(".card-slot");
        if (!slot) return;
        e.preventDefault();
        cyclePenaltyCard(slot);
      };
      // Touch support same as click
      penaltyCell.ontouchstart = (e) => {
        const slot = e.target.closest(".card-slot");
        if (!slot) return;
        e.preventDefault();
        cyclePenaltyCard(slot);
      };
    });
  }

  // Get unique key for a data cell: "row-col"
  function getCellKey(td) {
    const tr = td.parentElement;
    const rowIndex = Array.from(tbody.children).indexOf(tr);
    const colIndex = Array.from(tr.children).indexOf(td);
    return `${rowIndex}-${colIndex}`;
  }

  // Select a single cell
  function selectCell(td) {
    if (!td.classList.contains("data-cell")) return;
    selectedCells.add(getCellKey(td));
    td.classList.add("selected-cell");
    updateControlPanelState();
  }

  // Toggle cell selection in multi mode
  function toggleCellSelection(td) {
    if (!td.classList.contains("data-cell")) return;
    const key = getCellKey(td);
    if (selectedCells.has(key)) {
      selectedCells.delete(key);
      td.classList.remove("selected-cell");
    } else {
      selectedCells.add(key);
      td.classList.add("selected-cell");
    }
    updateControlPanelState();
  }

  // Clear all selections
  function clearSelection() {
    selectedCells.forEach((key) => {
      const [r, c] = key.split("-").map(Number);
      const row = tbody.children[r];
      if (!row) return;
      const cell = row.children[c];
      if (!cell) return;
      cell.classList.remove("selected-cell");
    });
    selectedCells.clear();
    updateControlPanelState();
  }

  // Update control panel buttons enabled/disabled based on selection
  function updateControlPanelState() {
    const hasSelection = selectedCells.size > 0;
    formatButtons.forEach((btn) => (btn.disabled = !hasSelection));
    selectColumnBtn.disabled = !hasSelection;
    clearSelectionBtn.disabled = !hasSelection;
  }

  // Apply formatting action to selected cells
  function applyFormatting(action) {
    if (selectedCells.size === 0) return;

    pushUndoState();

    selectedCells.forEach((key) => {
      const [r, c] = key.split("-").map(Number);
      const row = tbody.children[r];
      if (!row) return;
      const cell = row.children[c];
      if (!cell) return;

      switch (action) {
        case "markTick":
          setCellMark(cell, MARKS.tick);
          break;
        case "markCross":
          setCellMark(cell, MARKS.cross);
          break;
        case "markQuestion":
          setCellMark(cell, MARKS.question);
          break;
        case "bgLightGreen":
          setCellBackground(cell, BG_CLASSES.lightgreen);
          break;
        case "bgYellow":
          setCellBackground(cell, BG_CLASSES.yellow);
          break;
        case "bgOrange":
          setCellBackground(cell, BG_CLASSES.orange);
          break;
        case "bgDarkRed":
          setCellBackground(cell, BG_CLASSES.darkred);
          break;
        case "bgDiagonalLines":
          setCellBackground(cell, BG_CLASSES.diagonal);
          break;
        case "clearBG":
          clearCellBackground(cell);
          break;
        case "clearMarks":
          clearCellMark(cell);
          break;
      }
    });

    saveCurrentChart();
  }

  // Set mark icon in cell (tick, cross, question)
  function setCellMark(cell, markChar) {
    let markSpan = cell.querySelector(".cell-mark");
    if (!markSpan) {
      markSpan = document.createElement("span");
      markSpan.classList.add("cell-mark");
      cell.appendChild(markSpan);
    }
    markSpan.textContent = markChar;
  }

  // Clear mark icon from cell
  function clearCellMark(cell) {
    const markSpan = cell.querySelector(".cell-mark");
    if (markSpan) {
      markSpan.remove();
    }
  }

  // Set background class on cell (only one at a time)
  function setCellBackground(cell, bgClass) {
    // Remove all bg classes first
    Object.values(BG_CLASSES).forEach((cls) => cell.classList.remove(cls));
    cell.classList.add(bgClass);
  }

  // Clear background classes from cell
  function clearCellBackground(cell) {
    Object.values(BG_CLASSES).forEach((cls) => cell.classList.remove(cls));
  }

  // Cycle penalty card state for a slot element
  function cyclePenaltyCard(slot) {
    pushUndoState();

    const currentState = PENALTY_STATES.find((state) =>
      slot.classList.contains(`card-${state}`)
    );
    const currentIndex = PENALTY_STATES.indexOf(currentState || "empty");
    const nextIndex = (currentIndex + 1) % PENALTY_STATES.length;
    const nextState = PENALTY_STATES[nextIndex];

    // Remove all card classes
    slot.classList.remove("card-yellow", "card-orange", "card-red");

    if (nextState !== "empty") {
      slot.classList.add(`card-${nextState}`);
    }

    saveCurrentChart();
  }

  // Select entire column of data cells (excluding sticky columns)
  function selectColumn() {
    if (selectedCells.size === 0) return;
    pushUndoState();

    // Get column index of first selected cell
    const firstKey = selectedCells.values().next().value;
    const [, colIndex] = firstKey.split("-").map(Number);

    clearSelection();

    for (let r = 0; r < tbody.children.length; r++) {
      const row = tbody.children[r];
      if (!row) continue;
      const cell = row.children[colIndex];
      if (cell && cell.classList.contains("data-cell")) {
        selectedCells.add(`${r}-${colIndex}`);
        cell.classList.add("selected-cell");
      }
    }
    updateControlPanelState();
  }

  // Undo/Redo system

  // Push current chart state to undo stack
  function pushUndoState() {
    if (!currentChartId) return;
    const state = JSON.stringify(serializeCurrentChart());
    undoStack.push(state);
    // Clear redo stack on new action
    redoStack = [];
    updateUndoRedoButtons();
  }

  // Undo last action
  function undo() {
    if (undoStack.length === 0) return;
    const currentState = JSON.stringify(serializeCurrentChart());
    redoStack.push(currentState);

    const prevState = undoStack.pop();
    if (!prevState) return;

    loadChartFromState(prevState);
    updateUndoRedoButtons();
  }

  // Redo last undone action
  function redo() {
    if (redoStack.length === 0) return;
    const currentState = JSON.stringify(serializeCurrentChart());
    undoStack.push(currentState);

    const nextState = redoStack.pop();
    if (!nextState) return;

    loadChartFromState(nextState);
    updateUndoRedoButtons();
  }

  // Load chart from serialized state string
  function loadChartFromState(stateStr) {
    if (!currentChartId) return;
    try {
      const chartData = JSON.parse(stateStr);
      charts[currentChartId] = chartData;
      saveChartsToStorage();
      loadChart(currentChartId);
    } catch (e) {
      console.error("Failed to load chart state", e);
    }
  }

  // Enable/disable undo/redo buttons
  function updateUndoRedoButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  // Delete current chart after confirmation
  function deleteCurrentChart() {
    if (!currentChartId) return;
    if (
      confirm(
        `Are you sure you want to delete the chart "${charts[currentChartId].name}"? This action cannot be undone.`
      )
    ) {
      delete charts[currentChartId];
      saveChartsToStorage();
      // Load another chart or create new if none left
      const chartIds = Object.keys(charts);
      if (chartIds.length > 0) {
        loadChart(chartIds[0]);
      } else {
        createNewChart();
      }
      updateChartSelector();
    }
  }

  // Snapshot generation using html2canvas (or canvas API)
  // Since no external libs allowed, we implement a minimal snapshot using SVG + Canvas
  // We'll render the trackerTable as an image on canvas

  async function takeSnapshot() {
    // Disable snapshot button during processing
    snapshotBtn.disabled = true;

    try {
      // Clone the table to avoid scroll and selection artifacts
      const clone = trackerTable.cloneNode(true);

      // Remove selection highlights from clone
      clone.querySelectorAll(".selected-cell").forEach((cell) => {
        cell.classList.remove("selected-cell");
      });

      // Create SVG data with foreignObject to render HTML table
      const svgWidth = clone.scrollWidth + 40;
      const svgHeight = clone.scrollHeight + 40;

      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; font-size: 14px; background: white; padding: 10px;">
              ${clone.outerHTML}
              <div style="margin-top: 10px; font-weight: bold;">
                ${charts[currentChartId].name} - ${new Date().toLocaleString()}
              </div>
            </div>
          </foreignObject>
        </svg>
      `;

      const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = url;
      });

      // Draw on canvas
      snapshotCanvas.width = img.width;
      snapshotCanvas.height = img.height;
      const ctx = snapshotCanvas.getContext("2d");
      ctx.clearRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);

      URL.revokeObjectURL(url);

      // Show modal
      snapshotModal.hidden = false;
    } catch (e) {
      alert("Snapshot failed: " + e.message);
      console.error(e);
    } finally {
      snapshotBtn.disabled = false;
    }
  }

  // Download snapshot image as JPEG
  function downloadSnapshot() {
    const link = document.createElement("a");
    link.download = `${charts[currentChartId].name.replace(/\s+/g, "_")}_snapshot_${Date.now()}.jpg`;
    snapshotCanvas.toBlob((blob) => {
      if (!blob) {
        alert("Failed to generate image blob.");
        return;
      }
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    }, "image/jpeg", 0.95);
  }

  // Event listeners for UI controls

  newChartBtn.addEventListener("click", () => {
    createNewChart();
  });

  saveChartBtn.addEventListener("click", () => {
    saveCurrentChart();
    alert("Chart saved.");
  });

  deleteChartBtn.addEventListener("click", () => {
    deleteCurrentChart();
  });

  chartSelector.addEventListener("change", (e) => {
    const id = e.target.value;
    if (id && charts[id]) {
      loadChart(id);
    }
  });

  selectionModeRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      selectionMode = e.target.value;
      clearSelection();
      updateControlPanelState();
    });
  });

  formatButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      applyFormatting(action);
    });
  });

  selectColumnBtn.addEventListener("click", () => {
    selectColumn();
  });

  clearSelectionBtn.addEventListener("click", () => {
    clearSelection();
  });

  undoBtn.addEventListener("click", () => {
    undo();
  });

  redoBtn.addEventListener("click", () => {
    redo();
  });

  snapshotBtn.addEventListener("click", () => {
    takeSnapshot();
  });

  downloadSnapshotBtn.addEventListener("click", () => {
    downloadSnapshot();
  });

  closeSnapshotBtn.addEventListener("click", () => {
    snapshotModal.hidden = true;
  });

  // Keyboard shortcut support for undo/redo (Ctrl+Z / Ctrl+Y)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if (
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y")
    ) {
      e.preventDefault();
      redo();
    }
  });

  // Initialization on page load
  function init() {
    loadChartsFromStorage();

    if (Object.keys(charts).length === 0) {
      createNewChart();
    } else {
      updateChartSelector();
      if (!currentChartId) {
        currentChartId = Object.keys(charts)[0];
      }
      loadChart(currentChartId);
    }

    updateControlPanelState();
  }

  // Run init after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();