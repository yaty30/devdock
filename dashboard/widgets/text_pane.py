from ..common import *

class TextPane:
    def __init__(self, master, title, app, font_family="Calibri", compact=False,
                 collapsible=False, collapsed=False, collapsed_height=38,
                 actions=None, enable_search=True, show_line_numbers=True):
        self.app = app
        self.collapsible = collapsible
        self.collapsed = False
        self._expanded_height = None
        self._grid_info = None
        self.collapsed_height = collapsed_height
        self.enable_search = enable_search
        self.show_line_numbers = show_line_numbers
        self.visible_first_line = 1
        self.next_line_number = 1
        self.search_matches = []
        self.current_match_index = -1
        self._syncing_scroll = False

        self.frame = tk.Frame(master, bg=PANEL_BG, highlightthickness=1, highlightbackground=BORDER)
        self.title_var = tk.StringVar(value=title)
        self.title_bar = tk.Frame(self.frame, bg=PANEL_BG)
        self.title_bar.pack(fill="x", padx=10, pady=(8, 4))
        title_bar = self.title_bar

        self.toggle_btn = None
        if self.collapsible:
            self.toggle_btn = tk.Button(
                title_bar, text="▸", command=self.toggle_collapsed, bg=PANEL_BG, fg=MUTED,
                activebackground=PANEL_BG, activeforeground="#f1f5f9", relief="flat", bd=0,
                padx=2, pady=0, font=(font_family, 11, "bold"), cursor="hand2"
            )
            self.toggle_btn.pack(side="left", padx=(0, 4))

        self.title_label = tk.Label(
            title_bar, textvariable=self.title_var, bg=PANEL_BG, fg="#f1f5f9",
            font=(font_family, 12, "bold"), anchor="w"
        )
        self.title_label.pack(side="left")

        if self.collapsible:
            # Let users expand/collapse by clicking the panel title area, not only the small arrow.
            self.title_label.configure(cursor="hand2")
            self.title_bar.configure(cursor="hand2")
            self.title_label.bind("<Button-1>", lambda _event: self.toggle_collapsed())
            self.title_bar.bind("<Button-1>", lambda _event: self.toggle_collapsed())

        for label, command in (actions or []):
            tk.Button(
                title_bar, text=label, command=command, bg=BTN_BG, fg=BTN_FG,
                activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat",
                padx=8, pady=2, font=(font_family, 8, "bold"), cursor="hand2"
            ).pack(side="right", padx=(6, 0))

        self.status_var = tk.StringVar(value="Idle")
        self.status_label = tk.Label(
            title_bar, textvariable=self.status_var, bg=PANEL_BG, fg=MUTED,
            font=(font_family, 10), anchor="e"
        )
        self.status_label.pack(side="right", padx=(8, 0))

        self.search_bar = tk.Frame(self.frame, bg=PANEL_BG)
        if self.enable_search:
            self.search_var = tk.StringVar(value="")
            self.search_var.trace_add("write", lambda *_: self.search_text())
            tk.Label(self.search_bar, text="Find", bg=PANEL_BG, fg=MUTED,
                     font=(font_family, 9, "bold")).pack(side="left", padx=(10, 5))
            self.search_entry = tk.Entry(
                self.search_bar, textvariable=self.search_var, width=22,
                bg=TEXT_BG, fg=TEXT_FG, insertbackground=TEXT_FG, relief="flat",
                highlightthickness=1, highlightbackground=BORDER, highlightcolor=BLUE,
                font=(font_family, 9)
            )
            self.search_entry.pack(side="left")
            self.search_entry.bind("<Return>", self._search_enter)
            self.search_entry.bind("<Shift-Return>", lambda e: self.prev_match())
            tk.Button(self.search_bar, text="Prev", command=self.prev_match, bg=BTN_BG, fg=BTN_FG,
                      activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat",
                      padx=8, pady=2, font=(font_family, 8, "bold")).pack(side="left", padx=(6, 0))
            tk.Button(self.search_bar, text="Next", command=self.next_match, bg=BTN_BG, fg=BTN_FG,
                      activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat",
                      padx=8, pady=2, font=(font_family, 8, "bold")).pack(side="left", padx=(4, 0))
            tk.Button(self.search_bar, text="Clear", command=self.clear_search, bg=BTN_BG, fg=BTN_FG,
                      activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat",
                      padx=8, pady=2, font=(font_family, 8, "bold")).pack(side="left", padx=(4, 0))
            self.search_result_var = tk.StringVar(value="")
            tk.Label(self.search_bar, textvariable=self.search_result_var, bg=PANEL_BG, fg=MUTED,
                     font=(font_family, 9), anchor="w").pack(side="left", padx=(8, 0))
            self.search_bar.pack(fill="x", padx=0, pady=(0, 4))

        self.text_wrap = tk.Frame(self.frame, bg=PANEL_BG)
        self.text_wrap.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        self.scrollbar = ttk.Scrollbar(self.text_wrap, orient="vertical", style="Safari.Vertical.TScrollbar")
        self.scrollbar.pack(side="right", fill="y")
        self.h_scrollbar = ttk.Scrollbar(self.text_wrap, orient="horizontal", style="Safari.Horizontal.TScrollbar")
        self.h_scrollbar.pack(side="bottom", fill="x")
        height = 18 if not compact else 10

        self.line_numbers = None
        if self.show_line_numbers:
            self.line_numbers = tk.Text(
                self.text_wrap, width=6, bg="#0b0e12", fg=MUTED, relief="flat",
                wrap="none", cursor="arrow", takefocus=0, font=("Consolas", 10),
                height=height, padx=4, state="disabled"
            )
            self.line_numbers.pack(side="left", fill="y", padx=(0, 4))

        self.text = tk.Text(
            self.text_wrap, bg=TEXT_BG, fg=TEXT_FG, insertbackground=TEXT_FG, relief="flat",
            wrap="none", yscrollcommand=self._on_yscroll, xscrollcommand=self.h_scrollbar.set,
            font=(font_family, 10), undo=False, height=height
        )
        self.text.pack(side="left", fill="both", expand=True)
        self.scrollbar.config(command=self._scrollbar_yview)
        self.h_scrollbar.config(command=self.text.xview)
        self._configure_log_tags(font_family)
        self.auto_scroll = True

        for widget in (self.text, self.line_numbers):
            if widget is None:
                continue
            widget.bind("<MouseWheel>", self._handle_mousewheel)
            widget.bind("<Button-4>", self._handle_mousewheel)
            widget.bind("<Button-5>", self._handle_mousewheel)
        self.text.bind("<KeyRelease>", self._handle_scroll)
        self.text.bind("<ButtonRelease-1>", self._handle_scroll)
        self.text.bind("<Control-f>", self.focus_search)
        self.text.bind("<Control-F>", self.focus_search)

        if self.collapsible and collapsed:
            self.frame.after(0, self.collapse)

    def remember_grid(self):
        try:
            self._grid_info = self.frame.grid_info().copy()
        except Exception:
            self._grid_info = None

    def _on_yscroll(self, first, last):
        self.scrollbar.set(first, last)
        if self.line_numbers is not None and not self._syncing_scroll:
            try:
                self._syncing_scroll = True
                self.line_numbers.yview_moveto(first)
            finally:
                self._syncing_scroll = False

    def _scrollbar_yview(self, *args):
        self.text.yview(*args)
        if self.line_numbers is not None:
            self.line_numbers.yview(*args)

    def _handle_mousewheel(self, event=None):
        try:
            if event and getattr(event, "num", None) == 4:
                units = -3
            elif event and getattr(event, "num", None) == 5:
                units = 3
            else:
                units = int(-1 * (event.delta / 120)) if event else 0
            if units:
                self.text.yview_scroll(units, "units")
                if self.line_numbers is not None:
                    self.line_numbers.yview_scroll(units, "units")
            return "break"
        finally:
            self._handle_scroll()

    def _handle_scroll(self, _event=None):
        self.auto_scroll = self._is_at_bottom()

    def _is_at_bottom(self):
        try:
            return float(self.text.yview()[1]) >= 0.995
        except Exception:
            return True

    def focus_search(self, _event=None):
        if self.enable_search:
            if self.collapsible and self.collapsed:
                self.expand()
            self.search_entry.focus_set()
            self.search_entry.select_range(0, "end")
        return "break"

    def _search_enter(self, event=None):
        self.prev_match() if event and (event.state & 0x0001) else self.next_match()
        return "break"

    def toggle_collapsed(self):
        if not self.collapsible:
            return
        self.expand() if self.collapsed else self.collapse()

    def collapse(self):
        if not self.collapsible or self.collapsed:
            return
        self.remember_grid()
        current_height = self.frame.winfo_height()
        if current_height and current_height > self.collapsed_height + 20:
            self._expanded_height = current_height
        elif not self._expanded_height:
            self._expanded_height = 220
        self.collapsed = True
        self.text_wrap.pack_forget()
        if self.enable_search:
            self.search_bar.pack_forget()
        self.frame.pack_propagate(False)
        self.frame.grid_propagate(False)
        self.frame.configure(height=self.collapsed_height)
        try:
            if isinstance(self.frame.master, tk.PanedWindow):
                self.frame.master.paneconfigure(self.frame, minsize=self.collapsed_height, height=self.collapsed_height)
        except Exception:
            pass
        if self._grid_info and 'row' in self._grid_info:
            try:
                self.frame.master.grid_rowconfigure(int(self._grid_info['row']), weight=0)
            except Exception:
                pass
        if self.toggle_btn:
            self.toggle_btn.configure(text="▸")
        try:
            callback = getattr(self.app, "on_text_pane_collapsed", None)
            if callback:
                callback(self)
        except Exception:
            pass

    def expand(self):
        if not self.collapsible or not self.collapsed:
            return
        # Mark as expanded before changing geometry. PanedWindow <Configure> events can fire
        # during expansion; setting this first prevents a delayed collapsed-size callback
        # from immediately shrinking the pane again when there is no build running yet.
        self.collapsed = False
        expanded_height = max(self._expanded_height or 220, 220)
        if self.enable_search:
            # Both widgets are usually unpacked while collapsed. Do not use
            # pack(before=self.text_wrap) here: Tk raises a TclError if the
            # reference widget is not currently managed, which makes the
            # collapsed panel appear to do nothing when clicked. Re-pack in
            # the original order explicitly.
            self.search_bar.pack(fill="x", padx=0, pady=(0, 4))
        self.text_wrap.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        self.frame.configure(height=expanded_height)
        self.frame.pack_propagate(True)
        self.frame.grid_propagate(True)
        try:
            if isinstance(self.frame.master, tk.PanedWindow):
                self.frame.master.paneconfigure(self.frame, minsize=self.collapsed_height, height=expanded_height)
        except Exception:
            pass
        if self._grid_info and 'row' in self._grid_info:
            try:
                self.frame.master.grid_rowconfigure(int(self._grid_info['row']), weight=2)
            except Exception:
                pass
        if self.toggle_btn:
            self.toggle_btn.configure(text="▾")
        try:
            callback = getattr(self.app, "on_text_pane_expanded", None)
            if callback:
                callback(self)
        except Exception:
            pass

    def _configure_log_tags(self, font_family: str):
        mono = ("Consolas", 10)
        mono_bold = ("Consolas", 10, "bold")
        try:
            self.text.configure(font=mono)
        except Exception:
            self.text.configure(font=(font_family, 10))
        self.text.tag_config("log_default", foreground=TEXT_FG)
        self.text.tag_config("log_muted", foreground=MUTED)
        self.text.tag_config("log_info", foreground="#7db7ff")
        self.text.tag_config("log_command", foreground="#c792ea")
        self.text.tag_config("log_success", foreground=GREEN, font=mono_bold)
        self.text.tag_config("log_warning", foreground=YELLOW)
        self.text.tag_config("log_error", foreground=RED, font=mono_bold)
        self.text.tag_config("log_url", foreground="#80cbc4", underline=True)
        self.text.tag_config("log_war", foreground="#82aaff", underline=True, font=mono_bold)
        self.text.tag_config("log_timestamp", foreground=MUTED)
        self.text.tag_config("search_match", background="#514a20", foreground="#fff3b0")
        self.text.tag_config("search_current", background="#c77d1a", foreground="#ffffff", font=mono_bold)
        self.text.tag_raise("search_match")
        self.text.tag_raise("search_current")

    def _line_tag(self, line: str) -> str:
        low = line.lower()
        if any(token in low for token in ("build failure", " error", "[error]", "exception", " failed", "fatal")):
            return "log_error"
        if any(token in low for token in ("warning", "[warn]", "deprecated")):
            return "log_warning"
        if any(token in low for token in ("build success", "built in", "compiled successfully", "ready in", "done ✔", "success")):
            return "log_success"
        if any(token in low for token in ("npm run", "mvn ", "vite", "cmd.exe", "gradle", "yarn ", "git ")):
            return "log_command"
        if any(token in low for token in ("compiling", "packaging", "deploying", "deploy", "cleaning", "installing", "tailing:")):
            return "log_info"
        if re.match(r"^\s*(\[[^\]]+\]|\d{2}:\d{2}:\d{2})", line):
            return "log_muted"
        return "log_default"

    def _insert_line_number(self):
        if self.line_numbers is None:
            return
        self.line_numbers.configure(state="normal")
        self.line_numbers.insert("end", f"{self.next_line_number:>5}\n")
        self.line_numbers.configure(state="disabled")
        self.next_line_number += 1

    def _insert_colored_line(self, line: str):
        start = self.text.index("end-1c")
        self.text.insert("end", line, self._line_tag(line))
        if line.endswith("\n") or line.endswith("\r"):
            self._insert_line_number()
        patterns = [
            ("log_timestamp", r"\[[^\]]*\d{1,2}:\d{2}:\d{2}[^\]]*\]|\b\d{1,2}:\d{2}:\d{2}\b"),
            ("log_url", r"https?://[^\s]+|\blocalhost:\d+[^\s]*"),
            ("log_war", r"""(?:[A-Za-z]:\\|/|\./|\.\./)?[^\s'"<>|]+?\.war\b"""),
        ]
        for tag, pattern in patterns:
            for match in re.finditer(pattern, line, re.IGNORECASE):
                self.text.tag_add(tag, f"{start}+{match.start()}c", f"{start}+{match.end()}c")

    def append(self, text: str):
        if not text:
            return
        at_bottom_before = self._is_at_bottom()

        # Protect the UI from one very large queued chunk. The queue flusher
        # already throttles, but this keeps TextPane safe when called directly.
        if len(text) > 24000:
            text = text[-24000:]
            if not text.startswith("\n"):
                text = "\n[output truncated to keep UI responsive]\n" + text

        for line in text.splitlines(True):
            self._insert_colored_line(line)

        # Keep a bounded text buffer. The previous estimate used line_count*100
        # and removed only a small number of lines, which could still leave a
        # very large Tk text widget during noisy server startup.
        try:
            content_chars = int(self.text.count("1.0", "end-1c", "chars")[0])
        except Exception:
            content_chars = 0
        if content_chars > MAX_APPEND_CHARS:
            current_lines = int(float(self.text.index("end-1c").split(".")[0]))
            delete_lines = max(1, current_lines // 3)
            self.text.delete("1.0", f"{delete_lines}.0")
            if self.line_numbers is not None:
                self.line_numbers.configure(state="normal")
                self.line_numbers.delete("1.0", f"{delete_lines}.0")
                self.line_numbers.configure(state="disabled")
            self.visible_first_line += max(0, delete_lines - 1)
            if self.enable_search and self.search_var.get():
                self.search_text(keep_current=True)
        elif self.enable_search and self.search_var.get():
            self.search_text(keep_current=True)
        if self.auto_scroll or at_bottom_before:
            self.text.see("end")
            if self.line_numbers is not None:
                self.line_numbers.see("end")

    def clear(self):
        self.text.delete("1.0", "end")
        if self.line_numbers is not None:
            self.line_numbers.configure(state="normal")
            self.line_numbers.delete("1.0", "end")
            self.line_numbers.configure(state="disabled")
        self.visible_first_line = 1
        self.next_line_number = 1
        self.auto_scroll = True
        self.clear_search(clear_entry=False)

    def get_text(self) -> str:
        return self.text.get("1.0", "end-1c")

    def set_status(self, text: str, color=MUTED):
        self.status_var.set(text)
        self.status_label.configure(fg=color)

    def clear_search(self, clear_entry=True):
        self.text.tag_remove("search_match", "1.0", "end")
        self.text.tag_remove("search_current", "1.0", "end")
        self.search_matches = []
        self.current_match_index = -1
        if self.enable_search:
            if clear_entry:
                self.search_var.set("")
            self.search_result_var.set("")

    def search_text(self, keep_current=False):
        if not self.enable_search:
            return
        needle = self.search_var.get()
        self.text.tag_remove("search_match", "1.0", "end")
        self.text.tag_remove("search_current", "1.0", "end")
        self.search_matches = []
        old_index = self.current_match_index if keep_current else -1
        self.current_match_index = -1
        if not needle:
            self.search_result_var.set("")
            return
        start = "1.0"
        while True:
            pos = self.text.search(needle, start, stopindex="end", nocase=True)
            if not pos:
                break
            end = f"{pos}+{len(needle)}c"
            self.search_matches.append((pos, end))
            self.text.tag_add("search_match", pos, end)
            start = end
        if not self.search_matches:
            self.search_result_var.set("0 matches")
            return
        self.current_match_index = min(old_index, len(self.search_matches) - 1) if old_index >= 0 else 0
        self._show_current_match()

    def _show_current_match(self):
        self.text.tag_remove("search_current", "1.0", "end")
        if not self.search_matches or self.current_match_index < 0:
            return
        start, end = self.search_matches[self.current_match_index]
        self.text.tag_add("search_current", start, end)
        self.text.see(start)
        line_no = self.visible_first_line + int(start.split(".")[0]) - 1
        self.search_result_var.set(f"{self.current_match_index + 1} / {len(self.search_matches)} matches (line {line_no})")

    def next_match(self):
        if not self.search_matches:
            self.search_text()
            return "break"
        self.current_match_index = (self.current_match_index + 1) % len(self.search_matches)
        self._show_current_match()
        return "break"

    def prev_match(self):
        if not self.search_matches:
            self.search_text()
            return "break"
        self.current_match_index = (self.current_match_index - 1) % len(self.search_matches)
        self._show_current_match()
        return "break"


