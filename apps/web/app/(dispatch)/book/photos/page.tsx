"use client";

import React, { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { generatePriceEstimate } from "@/lib/dispatch/price-estimator";

const MAX_PHOTOS = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

interface PhotoPreview {
  name: string;
  url: string;
  file: File;
}

function PhotoUploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = searchParams.get("category") ?? "";
  const description = searchParams.get("description") ?? "";

  const [photos, setPhotos] = useState<PhotoPreview[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(evt: React.ChangeEvent<HTMLInputElement>) {
    setErrorMsg("");
    const selected = Array.from(evt.target.files ?? []);
    const oversized = selected.filter((f) => f.size > MAX_BYTES);
    if (oversized.length > 0) {
      setErrorMsg(
        `${oversized.map((f) => f.name).join(", ")} exceed${oversized.length === 1 ? "s" : ""} the 10 MB limit.`,
      );
      return;
    }
    const newPreviews: PhotoPreview[] = selected.map((f) => ({
      name: f.name,
      url: URL.createObjectURL(f),
      file: f,
    }));
    const combined = [...photos, ...newPreviews].slice(0, MAX_PHOTOS);
    setPhotos(combined);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function handleSubmit(evt: React.FormEvent<HTMLFormElement>) {
    evt.preventDefault();
    if (!category || !description) {
      router.push("/book");
      return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      const fd = new FormData();
      fd.append("category", category);
      fd.append("description", description);
      for (const p of photos) {
        fd.append("photos", p.file);
      }
      const estimate = await generatePriceEstimate(fd);
      router.push(`/book/confirm?id=${estimate.id}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unexpected error generating estimate.";
      setErrorMsg(`Failed to generate estimate: ${message}`);
      setSubmitting(false);
    }
  }

  if (!category || !description) {
    return (
      <main>
        <h1>Missing information</h1>
        <p>
          Please{" "}
          <a href="/book" className="btn secondary">
            start from the beginning
          </a>
          .
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Add Photos</h1>
      <p>
        Upload up to {MAX_PHOTOS} photos of the issue. Clear photos help our AI
        produce a more accurate estimate.
      </p>

      <div className="card">
        <p className="muted">
          <strong>Category:</strong>{" "}
          {category.charAt(0).toUpperCase() + category.slice(1)}
        </p>
        <p className="muted">
          <strong>Description:</strong> {description}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="photo-input">
          Select photos (JPEG, PNG, WebP — max 10 MB each)
        </label>
        <input
          id="photo-input"
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          disabled={photos.length >= MAX_PHOTOS || submitting}
          onChange={handleFileChange}
        />

        {photos.length > 0 && (
          <ul>
            {photos.map((p, idx) => (
              <li key={p.url}>
                <img
                  src={p.url}
                  alt={p.name}
                  style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6 }}
                />
                <span style={{ marginLeft: 10 }}>{p.name}</span>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ marginLeft: 12 }}
                  onClick={() => removePhoto(idx)}
                  disabled={submitting}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {photos.length === 0 && (
          <div className="empty">
            No photos selected yet. You can still get an estimate without photos.
          </div>
        )}

        {errorMsg && (
          <p style={{ color: "var(--color-danger, #dc2626)" }}>{errorMsg}</p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? "Generating estimate…" : "Get Instant Price Estimate"}
        </button>
      </form>
    </main>
  );
}

export default function PhotosPage() {
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <PhotoUploadContent />
    </Suspense>
  );
}
