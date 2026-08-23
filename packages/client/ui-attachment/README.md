# @deepseek-ai/dsh-client-ui-attachment

English | [中文](README.zh.md)

Dynamic attachment presentation plugin for the conversation UI. It waits for the conversation package's `conversation.input.attachments` and `conversation.message.images` declarations through `ctx.slots.inject`, then registers the composer draft-image and document rails, folder/image drop target, chat-history image gallery, and original-image lightbox. When `dsh-better-sidebar` is composed, it also registers a hidden uploaded-document tab type and turns each document card into a right-sidebar preview action. The conversation slot owner supplies attachment data, browser-file resolution, image loading, callbacks, and its namespace translator; presentation components remain pure props and are not exported from the package entry.

## Attachment rail

`AttachmentRail` renders pending draft images as fixed 64px thumbnails (16px radius) in one horizontally scrolling row whose scrollbar stays hidden. Overflow is announced by circular edge arrows instead: each pages one viewport (minus one card of context, floored at 200px) with smooth scrolling (instant under `prefers-reduced-motion: reduce`), and arrow visibility is recomputed from scroll geometry on scroll, item-count changes, and rail size changes (a ResizeObserver on the rail element, so sidebar and panel resizes count, not only window resizes). The rail scrolls horizontally only: a non-passive listener consumes every wheel tick with a vertical component — nothing scrolls the conversation behind the composer — converting a pure vertical wheel to a horizontal step (LINE/PAGE deltas normalized to pixels, per-tick travel clamped to 60px) and keeping a diagonal pan's horizontal intent, while purely horizontal pans stay native. A newly added item is revealed at the rail's end; removal keeps the scroll position, and a rail that mounts over an already-populated draft keeps its start position. Each thumbnail opens its original through `onOpen` on a single click, and its remove control sits inside the card's top-right corner, hidden until the card is hovered or the control keyboard-focused; coarse-pointer (touch) surfaces show it permanently because they have no hover. The owner decides mounting and renders the rail only while items exist.

## Message images and the lightbox

`MessageImage` renders one durable history image, loading a session-authorized URL through the owner's `ImageLoader`; a failed load renders an explicit retry control, and a settled load answers a single click by opening `ImageLightbox` (clicks during loading are ignored). Sizing follows DeepSeek Chat: a message's lone image (`variant="single"`) renders at 240px on its longer edge with the displayed aspect ratio clamped to [0.25, 4] — the overflow is cropped by `object-fit: cover`, anchored to the top of very tall images and the left of very wide ones — and never upscales past its natural size; an image among several (`variant="tile"`) is a fixed 64px square. `ImageGallery` wraps a message's images in one aligned wrapping flex group (`end` for user messages, `start` for assistant messages), picks the variant from the image count, and renders nothing for an empty list. `ImageLightbox` is a document-level modal preview over the shared dialog mask (`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`, painted on its own layer so the blur never touches the previewed image) that closes on Escape, a mask press, or its close control, and restores focus to its opener on unmount.

## Drop overlay

`DropOverlay` is the full-viewport invitation shown while a file-system drag is over the page: illustration, title, and a limits line while drops are accepted (`disabled` swaps the blocked illustration and hides the limits line). The layer is pointer-inert — the owner's document-level drag listeners keep the enter/leave count and decide accept/reject; the overlay only shows state. On drop, `ComposerAttachments` separates directory entries from ordinary files without opening a directory reader: directories contribute path metadata through `onAddDirectories`, while files retain the existing image intake callback. A native client-provided `File.path` wins; otherwise the browser entry's root-relative `fullPath` is used. It portals to the body like the lightbox.

## Uploaded document preview

The document rail presents every runtime-only OCR row while extraction is pending, ready, or failed. With `dsh-better-sidebar` available, selecting the card opens or focuses a session-targeted `dsh:uploaded-document` tab and expands the panel. The tab reads the immutable browser `File` already retained by `ui-conversation`; it does not stage a copy in the workspace, call a Host file-read route, or persist file bytes in sidebar state. Removing the row, admitting the prompt, or disposing the plugin closes the tab before releasing that browser reference.

PDF uses the browser's native viewer, common images use Blob URLs, DOCX uses `docx-preview`, PPTX uses sanitized SVG from Office Kit, and XLSX uses a semantic table bounded to 200 rows by 50 columns. A download link remains available for every format. The external Office viewer plugin remains responsible for `.docx`, `.xlsx`, and `.pptx` files opened from the workspace explorer; uploaded composer files do not depend on that profile extension.

## Model Experience

None, as directory drops only pass path metadata to the conversation owner's draft callback and document preview reads only the browser-held file for presentation; this plugin never reads directory contents or assembles model requests.

#### KV Cache effect

One dropped directory changes only the next user-message suffix by its `@path/` text. This package does not assemble or send provider requests itself.

## Known Limitations and Deferred Work

- **Document preview is a reading aid** — complex Word, PowerPoint, and spreadsheet layout can differ from Microsoft Office, and PDF rendering depends on the browser. Legacy `.doc`, `.xls`, and `.ppt` files are not accepted by the upload control.
- **Standard browsers expose relative directory metadata** — a normal Web page receives the dragged root relative to the drag data store, not its operating-system absolute path. Native clients may expose an absolute `File.path`; otherwise the resulting reference is relative to the session workspace and does not grant access to a directory outside that workspace.
- **No zoom or download in the lightbox** — the preview renders the original at fit-to-viewport size only.
- **The lightbox does not trap focus** — it sets `aria-modal` and restores focus on close, but Tab can reach the page behind it.
