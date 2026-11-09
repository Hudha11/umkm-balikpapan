"use strict";

const express = require("express");
const path = require("node:path");

const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_API = "https://sobatumkmbpp.balikpapan.go.id/api/v1/shops";

const PAGE_SIZE = 10;
const CACHE_TTL = 5 * 60 * 1000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

let shopsCache = {
  data: null,
  fetchedAt: 0,
  pagesFetched: 0,
};

// Mengambil JSON dari API sumber
async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SOBATDATA-UMKM-Directory/1.0",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Sumber SOBAT UMKM merespons HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error("Respons sumber bukan JSON.");
  }

  return response.json();
}

// Mengambil seluruh halaman UMKM
async function getAllShops(forceRefresh = false) {
  const cacheIsValid =
    shopsCache.data && Date.now() - shopsCache.fetchedAt < CACHE_TTL;

  if (!forceRefresh && cacheIsValid) {
    return {
      results: shopsCache.data,
      pagesFetched: shopsCache.pagesFetched,
      cached: true,
    };
  }

  // Ambil halaman pertama
  const firstPage = await fetchJson(`${SOURCE_API}?page=1`);

  if (!Array.isArray(firstPage.results)) {
    throw new Error("Format data halaman pertama tidak valid.");
  }

  const totalCount = Number(firstPage.count) || firstPage.results.length;

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const allResults = [...firstPage.results];

  // Ambil halaman berikutnya dalam batch 5 halaman
  const batchSize = 5;

  for (let start = 2; start <= totalPages; start += batchSize) {
    const end = Math.min(start + batchSize - 1, totalPages);

    const pageNumbers = Array.from(
      { length: end - start + 1 },
      (_, index) => start + index,
    );

    const pageResults = await Promise.all(
      pageNumbers.map(async (page) => {
        const pageData = await fetchJson(`${SOURCE_API}?page=${page}`);

        if (!Array.isArray(pageData.results)) {
          throw new Error(`Format data halaman ${page} tidak valid.`);
        }

        return pageData.results;
      }),
    );

    pageResults.forEach((rows) => {
      allResults.push(...rows);
    });
  }

  // Simpan cache
  shopsCache = {
    data: allResults,
    fetchedAt: Date.now(),
    pagesFetched: totalPages,
  };

  return {
    results: allResults,
    pagesFetched: totalPages,
    cached: false,
  };
}

// 1. Endpoint seluruh data UMKM
app.get("/api/shops", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "true";

    const data = await getAllShops(forceRefresh);

    res.json({
      success: true,
      total_found: data.results.length,
      pages_fetched: data.pagesFetched,
      cached: data.cached,
      results: data.results,
    });
  } catch (error) {
    console.error("Gagal mengambil data UMKM:", error.message);

    res.status(502).json({
      success: false,
      message: error.message,
    });
  }
});

// 2. Endpoint filter berdasarkan kelurahan
app.get("/api/shops/filter", async (req, res) => {
  try {
    const kelurahan = String(req.query.kelurahan || "").trim();

    if (!kelurahan) {
      return res.status(400).json({
        success: false,
        message: "Parameter kelurahan wajib diisi.",
      });
    }

    const data = await getAllShops(req.query.refresh === "true");

    const results = data.results.filter(
      (shop) =>
        String(shop.urban_village || "")
          .trim()
          .toLowerCase() === kelurahan.toLowerCase(),
    );

    res.json({
      success: true,
      total_found: results.length,
      pages_fetched: data.pagesFetched,
      results,
    });
  } catch (error) {
    console.error("Error filter UMKM:", error.message);

    res.status(502).json({
      success: false,
      message: error.message,
    });
  }
});

// 3. Endpoint daftar kelurahan
app.get("/api/locations", async (req, res) => {
  try {
    const data = await getAllShops();

    const locations = [
      ...new Set(
        data.results
          .map((shop) => String(shop.urban_village || "").trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "id"));

    res.json({
      success: true,
      results: locations,
    });
  } catch (error) {
    console.error("Gagal mengambil daftar kelurahan:", error.message);

    res.status(502).json({
      success: false,
      message: error.message,
    });
  }
});

// 4. Endpoint pengecekan server
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Server Direktori UMKM berjalan.",
    cached_data: Boolean(shopsCache.data),
    cached_total: shopsCache.data?.length || 0,
  });
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`Server Direktori UMKM berjalan di http://localhost:${PORT}`);
});
