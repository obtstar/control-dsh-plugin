// control-dsh-plugin client 半区（浏览器端）：在会话页 header 注入 control 状态 div。
// 经 dsh-client-modules 的 boot graph 加载（Node 半区扫描 dsh.client 声明 → /plugins serve）。
// 纯 DOM 注入，不依赖 React/UI 库；CSS module 类名按 dsh 的 `<hash>_<name>` 约定，
// 用 `[class$="_header"]`（后缀稳定）定位会话页顶栏。
window.__ModuleLoader__.load({
	id: "control-dsh-plugin",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;

		const name = "control-header";
		const inject = [];

		function apply() {
			if (typeof document === "undefined") return;
			const API_PREFIX = "/control/dashboard/api";

			// 定位会话页顶栏：dsh CSS module 类名 `<hash>_header`，含 `_titleRow` 子元素
			function findHeader() {
				const candidates = document.querySelectorAll('[class$="_header"]');
				for (const el of candidates) {
					if (el.querySelector('[class$="_titleRow"]') || el.querySelector('[class$="_headerActions"]')) {
						return el;
					}
				}
				return null;
			}

			let injected = null;
			let timer = null;

			async function refresh() {
				if (!injected) return;
				try {
					const res = await fetch(`${API_PREFIX}/approvals/pending`, { cache: "no-store" });
					if (!res.ok) throw new Error(String(res.status));
					const rows = await res.json();
					const count = Array.isArray(rows) ? rows.length : 0;
					const badge = injected.querySelector("[data-control-count]");
					if (badge) {
						badge.textContent = String(count);
						badge.title = count ? `control 待审批 ${count} 项` : "control 无待审批";
					}
				} catch {
					const badge = injected.querySelector("[data-control-count]");
					if (badge) badge.textContent = "–";
				}
			}

			function injectInto(header) {
				if (injected && injected.isConnected) return;
				const div = document.createElement("div");
				div.dataset.controlHeader = "true";
				div.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin:0 10px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2,#30363d);border-radius:12px;font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);background:var(--dsw-alias-interactive-bg-hover,transparent);cursor:pointer;user-select:none;white-space:nowrap;";
				div.innerHTML = "control <b data-control-count style=\"color:var(--dsw-alias-label-primary,#f0f6fc)\">–</b>";
				div.title = "control 待审批数；点击打开看板";
				div.addEventListener("click", () => { window.location.href = "/control/dashboard"; });
				// 插入到 titleRow 之后（header 右侧）
				const titleRow = header.querySelector('[class$="_titleRow"]');
				if (titleRow && titleRow.nextSibling) {
					header.insertBefore(div, titleRow.nextSibling);
				} else {
					header.appendChild(div);
				}
				injected = div;
				refresh();
				if (timer) clearInterval(timer);
				timer = setInterval(refresh, 30000);
			}

			// 等 header 渲染（SPA 路由切换会重建）
			const observer = new MutationObserver(() => {
				const header = findHeader();
				if (header) injectInto(header);
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
			const initial = findHeader();
			if (initial) injectInto(initial);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
