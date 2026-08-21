// control-dsh-plugin client 半区（浏览器端）v0.5：
//   1) sidebar 注入 "▤ Control" 导航项（点击 → 主区切换 Control 标签页）
//   2) header 注入 control 待审批徽标
//   3) conversation 区域注入 Control 标签页（与 Chat/Trajectory 并列）
// 经 dsh-client-modules boot graph 加载。
window.__ModuleLoader__.load({
	id: "control-dsh-plugin",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;

		const name = "control-ui";
		const inject = [];

		function apply() {
			if (typeof document === "undefined") return;
			const API_PREFIX = "/control/dashboard/api";

			// ── 工具 ─────────────────────────────────────────────
			async function fetchCount() {
				try {
					const res = await fetch(`${API_PREFIX}/approvals/pending`, { cache: "no-store" });
					if (!res.ok) return null;
					const rows = await res.json();
					return Array.isArray(rows) ? rows.length : 0;
				} catch { return null; }
			}

			// ── 1) header 徽标 ───────────────────────────────────
			let headerBadge = null;
			let badgeTimer = null;

			async function refreshBadge() {
				const count = await fetchCount();
				const text = count === null ? "–" : String(count);
				if (headerBadge) {
					headerBadge.querySelector("[data-control-count]").textContent = text;
					headerBadge.title = count === null ? "control 不可达" : `control 待审批 ${count} 项`;
				}
			}

			function findHeader() {
				const candidates = document.querySelectorAll('[class$="_header"]');
				for (const el of candidates) {
					if (el.querySelector('[class$="_titleRow"]') || el.querySelector('[class$="_headerActions"]')) return el;
				}
				return null;
			}

			function injectHeader(header) {
				if (!header) return;
				if (headerBadge && headerBadge.isConnected) return;
				const div = document.createElement("div");
				div.dataset.controlHeader = "true";
				div.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin:0 10px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2,#30363d);border-radius:12px;font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;white-space:nowrap;";
				div.innerHTML = "control <b data-control-count style=\"color:var(--dsw-alias-label-primary,#f0f6fc)\">–</b>";
				div.title = "control 待审批数；点击打开看板";
				div.addEventListener("click", () => switchToControlTab());
				const titleRow = header.querySelector('[class$="_titleRow"]');
				if (titleRow && titleRow.nextSibling) header.insertBefore(div, titleRow.nextSibling);
				else header.appendChild(div);
				headerBadge = div;
			}

			// ── 2) sidebar 导航项 ────────────────────────────────
			let sidebarItem = null;

			function findSidebarRegion() {
				// sidebar 主区域（workspaces 列表容器）；footer 区域不要
				const areas = document.querySelectorAll('[class$="_regionArea"]');
				for (const el of areas) {
					if (el.querySelector('[class$="_newSession"]') || el.querySelector('[class$="_settingsArea"]')) continue;
					return el;
				}
				return null;
			}

			function injectSidebar(region) {
				if (!region) return;
				if (sidebarItem && sidebarItem.isConnected) return;
				const item = document.createElement("button");
				item.dataset.controlSidebar = "true";
				item.style.cssText = "display:flex;align-items:center;gap:8px;width:calc(100% - 8px);margin:2px 4px;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#f0f6fc);font-size:14px;cursor:pointer;text-align:left;";
				item.addEventListener("mouseenter", () => { item.style.background = "var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))"; });
				item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
				item.innerHTML = "<span style=\"opacity:.8\">▤</span> Control <b data-control-sidebar-count style=\"margin-left:auto;opacity:.7;font-size:12px\">–</b>";
				item.title = "control 任务看板（待审批数）";
				// 点击 sidebar 按钮 → 切换到 Control 标签页
				item.addEventListener("click", () => switchToControlTab());
				region.insertBefore(item, region.firstChild);
				sidebarItem = item;
			}

			// ── 3) 注入 conversation.view 标签页 ─────────────────
			let controlTab = null;
			let controlPanel = null;

			function findConversationTabBar() {
				const tabs = document.querySelectorAll('[class*="_tab"], [role="tablist"]');
				for (const el of tabs) {
					if (el.textContent.includes("Chat") || el.textContent.includes("Trajectory") || el.textContent.includes("对话") || el.textContent.includes("轨迹")) {
						return el;
					}
				}
				return null;
			}

			function findConversationBody() {
				const bodies = document.querySelectorAll('[class*="_centerCol"], [class*="_sessionBody"]');
				for (const el of bodies) {
					if (el.children.length > 0) return el;
				}
				return null;
			}

			function switchToControlTab() {
				// 显示 Control 面板
				if (controlPanel) {
					controlPanel.style.display = "block";
					const siblings = controlPanel.parentElement?.children;
					if (siblings) {
						for (const sib of siblings) {
							if (sib !== controlPanel && sib.tagName !== "STYLE") {
								sib.style.display = "none";
							}
						}
					}
				}
				// 激活 Control 标签样式
				if (controlTab) {
					controlTab.style.borderBottom = "2px solid var(--dsw-accent,#1f6feb)";
					controlTab.style.color = "var(--dsw-alias-label-primary,#f0f6fc)";
				}
				// 重置其他标签
				const tabBar = controlTab?.parentElement;
				if (tabBar) {
					for (const tab of tabBar.children) {
						if (tab !== controlTab && tab.dataset?.controlTab !== "true") {
							tab.style.borderBottom = "2px solid transparent";
							tab.style.color = "";
						}
					}
				}
			}

			function injectControlTab(tabBar) {
				if (!tabBar) return;
				if (controlTab && controlTab.isConnected) return;

				const tab = document.createElement("button");
				tab.dataset.controlTab = "true";
				tab.textContent = "Control";
				// 复制现有标签样式
				const existingTab = tabBar.querySelector("button, [role='tab']");
				if (existingTab) {
					tab.style.cssText = window.getComputedStyle(existingTab).cssText;
				} else {
					tab.style.cssText = "padding:6px 14px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;font-size:13px;transition:all 0.15s;";
				}
				tab.addEventListener("click", () => switchToControlTab());
				tabBar.appendChild(tab);
				controlTab = tab;

				// 创建 Control 面板（iframe 内嵌）
				const body = findConversationBody();
				if (body) {
					const panel = document.createElement("div");
					panel.dataset.controlPanel = "true";
					panel.style.cssText = "display:none;height:100%;width:100%;position:absolute;top:0;left:0;z-index:10;";
					const frame = document.createElement("iframe");
					frame.src = "/control/dashboard";
					frame.style.cssText = "width:100%;height:100%;border:0;";
					panel.appendChild(frame);
					body.appendChild(panel);
					controlPanel = panel;
				}
			}

			// ── 观察 DOM ─────────────────────────────────────────
			const observer = new MutationObserver(() => {
				const header = findHeader();
				if (header) injectHeader(header);
				const region = findSidebarRegion();
				if (region) injectSidebar(region);
				const tabBar = findConversationTabBar();
				if (tabBar) injectControlTab(tabBar);
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
			const h0 = findHeader();
			if (h0) injectHeader(h0);
			const r0 = findSidebarRegion();
			if (r0) injectSidebar(r0);
			const t0 = findConversationTabBar();
			if (t0) injectControlTab(t0);
			refreshBadge();
			if (badgeTimer) clearInterval(badgeTimer);
			badgeTimer = setInterval(refreshBadge, 30000);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
