export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createReaderSharing({ bookId, getBookMeta, el, showToast }) {
  async function copyShareLink(url) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        return;
      } catch {
        // Continue to the selection-based fallback when clipboard access is denied.
      }
    }

    const input = document.createElement("textarea");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    let copied;
    try {
      input.select();
      copied = document.execCommand("copy");
    } finally {
      input.remove();
    }
    if (!copied) throw new Error("Copying the link is not supported.");
  }

  async function shareQuoteImage(quote, filename, title) {
    const bookMeta = getBookMeta();
    try {
      const blob = await createQuoteCard(quote, bookMeta);
      const file =
        typeof File !== "undefined"
          ? new File([blob], filename, { type: "image/png" })
          : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title,
            text: bookMeta?.author
              ? `${bookMeta.title} — ${bookMeta.author}`
              : bookMeta?.title || "",
          });
          showToast("Quote image shared.");
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }

      downloadBlob(blob, filename);
      showToast("Quote image downloaded.");
    } catch {
      showToast("Unable to create the quote image.");
    }
  }

  el.shareBtn.addEventListener("click", async () => {
    const bookMeta = getBookMeta();
    if (!bookMeta || !bookId) return;
    el.shareStatus.textContent = "";
    el.shareStatus.hidden = true;

    const url = new URL("reader.html", location.href);
    url.searchParams.set("id", bookId);
    const shareData = {
      title: bookMeta.title,
      text: `Read "${bookMeta.title}" by ${bookMeta.author} on 3NDING.`,
      url: url.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        showToast("Book shared.");
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }

    try {
      await copyShareLink(url.href);
      showToast("Book link copied to clipboard.");
    } catch {
      showToast("Unable to copy the book link.");
    }
  });

  return { shareQuoteImage };
}

async function createQuoteCard(quote, bookMeta) {
  await Promise.all([
    document.fonts.load("54px Literata"),
    document.fonts.load("24px 'Space Mono'"),
    document.fonts.load("30px 'Work Sans'"),
  ]);
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");

  context.font = "54px Literata, Georgia, serif";
  const lines = [];
  let line = "";
  const maxWidth = 976;
  const words = `“${String(quote).replace(/\s+/g, " ").trim()}”`.split(/\s+/);
  words.forEach((word) => {
    let candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
  });
  if (line) lines.push(line);
  const lineHeight = 82;
  const quoteHeight = lines.length * lineHeight;
  canvas.height = Math.max(1500, 360 + quoteHeight + 360);
  context.fillStyle = "#171b21";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#d4ac57";
  context.fillRect(112, 112, 72, 4);
  context.fillStyle = "#d4ac57";
  context.font = "24px 'Space Mono', monospace";
  context.fillText("3NDING  /  A LINE TO KEEP", 112, 170);

  context.fillStyle = "#f2e9d3";
  context.font = "54px Literata, Georgia, serif";
  context.textAlign = "center";
  let y = Math.max(360, (canvas.height - quoteHeight) / 2);
  lines.forEach((quoteLine) => {
    context.fillText(quoteLine, canvas.width / 2, y, maxWidth);
    y += lineHeight;
  });

  context.fillStyle = "#b8923f";
  context.textAlign = "left";
  const footerY = canvas.height - 260;
  context.fillRect(112, footerY, 976, 1);
  context.fillStyle = "#ece4d1";
  context.font = "30px 'Work Sans', sans-serif";
  context.fillText(bookMeta?.title || "", 112, footerY + 70, 976);
  context.fillStyle = "#9aa2ad";
  context.font = "24px 'Work Sans', sans-serif";
  context.fillText(bookMeta?.author || "", 112, footerY + 115, 976);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The quote card image could not be encoded."));
    }, "image/png");
  });
}
