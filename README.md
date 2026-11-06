# TaskFlow

Aplikasi manajemen tugas cerdas untuk mahasiswa dan pekerja pemula di Indonesia.
Dibangun dengan HTML5, CSS3, dan Vanilla JavaScript murni — tanpa framework, tanpa CDN, tanpa backend.

---

## Cara Menjalankan

1. Unduh atau clone repositori ini.
2. Buka file **`index.html`** langsung di browser (Chrome, Firefox, Edge, Safari modern).
3. Tidak diperlukan server web atau instalasi tambahan.
4. Semua data tersimpan otomatis di **localStorage** browser Anda.

---

## Daftar Fitur

### Manajemen Tugas
- **Tambah tugas** via tombol "+ Tugas Baru" atau tekan `N`
- **Edit inline** dengan klik ganda pada judul tugas
- **Edit lengkap** via tombol ✏️ (buka modal dengan semua field)
- **Hapus** dengan konfirmasi dialog, dilengkapi tombol **Urungkan** (8 detik)
- **Tandai selesai** via checkbox dengan efek strike-through

### Field Tugas
- Judul, deskripsi, kategori, prioritas
- Tanggal & jam tenggat
- Subtugas (checklist) dengan progress counter (mis. 2/5) dan mini progress bar
- Opsi berulang: Harian, Mingguan, Bulanan
- Status Kanban: Akan Dikerjakan / Sedang Dikerjakan / Selesai

### Quick-Add Cerdas (AI Agent Style)
Ketik kalimat alami di kotak input "Tambah cepat" dan tekan **Proses** atau `Enter`.

**Contoh kalimat quick-add:**
```
kumpul laporan RO besok jam 10 prioritas tinggi #kuliah
```
```
beli buku teks tgl 15 jam 09:30 #belanja prioritas rendah
```
```
meeting tim lusa jam 14 prio sedang #kerja
```
```
latihan LeetCode hari ini jam 20 #pribadi
```
```
review PR github urgent #kerja
```

Parser akan mengekstrak:
- **Judul** (sisa teks setelah mengekstrak metadata)
- **Tanggal**: "hari ini", "besok", "lusa", "tgl N"
- **Jam**: "jam HH" atau "jam HH:MM"
- **Prioritas**: "prioritas tinggi/sedang/rendah", "prio …", "urgent"
- **Kategori**: `#kuliah`, `#kerja`, `#pribadi`, `#belanja`, `#lainnya`

Preview chip akan muncul — klik **✓ Konfirmasi** untuk simpan langsung, atau **✎ Edit** untuk membuka modal dan menyesuaikan lebih lanjut.

### Pencarian & Filter
- Cari berdasarkan kata kunci (judul & deskripsi)
- Filter status: Semua / Aktif / Selesai
- Filter kategori (sidebar)
- Filter prioritas
- Urutkan berdasarkan: Terbaru / Tenggat / Prioritas

### Kesadaran Tenggat
- Tugas **terlambat** disorot merah 🔴
- Tugas **jatuh tempo hari ini** disorot kuning 🟡
- Bagian **"Hari Ini"** tampil di atas daftar utama
- **Toast reminder** otomatis untuk tugas yang jatuh tempo dalam 1 jam (dicek setiap menit)

### Tugas Berulang
- Saat tugas berulang diselesaikan, TaskFlow otomatis membuat kejadian berikutnya
- Mendukung: Harian, Mingguan, Bulanan

### Drag & Drop
- Seret kartu tugas untuk **mengubah urutan** di tampilan daftar
- Seret kartu ke kolom berbeda di **tampilan Kanban** untuk mengubah status

### Tampilan Kanban
- Toggle antara tampilan **Daftar** dan **Kanban** via tombol di topbar
- Tiga kolom: Akan Dikerjakan | Sedang Dikerjakan | Selesai
- Drag & drop antar kolom

### Dashboard Produktivitas (Sidebar)
- Total tugas, selesai hari ini, streak harian 🔥
- **Progress ring** tingkat penyelesaian
- **Bar chart** tugas per kategori (SVG/CSS murni)

### Timer Pomodoro (Floating)
- Timer 25 menit fokus + 5 menit istirahat
- Kaitkan ke tugas tertentu via tombol 🍅 di kartu tugas
- Kontrol: Mulai ▶, Jeda ⏸, Reset ↺
- Sinyal visual (flash bar) saat timer selesai
- Buka/tutup via FAB 🍅 di pojok kanan bawah

### Alat Data
- **Ekspor** semua tugas ke file `.json`
- **Impor** dari file `.json` (dengan validasi & sanitasi)
- **Hapus semua yang selesai** (satu klik)
- **Reset data** (kembali ke 6 tugas dummy)
- **Undo hapus** via toast "Urungkan"

### Tema & Aksesibilitas
- Toggle **tema gelap/terang** (tersimpan di localStorage)
- Kontras WCAG AA
- Focus states yang terlihat jelas
- `aria-label` pada semua tombol ikon
- HTML semantik + `role` attributes
- Focus trap di modal
- Keyboard shortcuts

---

## Pintasan Keyboard

| Shortcut | Aksi |
|----------|------|
| `N` | Buka modal tambah tugas baru |
| `/` | Fokus ke kotak pencarian |
| `Esc` | Tutup modal / preview / clarify |
| `Enter` (di quick-add) | Proses quick-add |
| `Enter` (di form subtugas) | Tambah subtugas |

---

## Struktur File

```
taskflow/
├── index.html   — Struktur HTML semantik, aria, modal, widget Pomodoro
├── style.css    — Design system, CSS custom properties, responsive, dark/light
├── app.js       — Semua logika: state, storage, parser, tasks, filters,
│                  kanban, dashboard, pomodoro, UI, events
└── README.md    — Dokumentasi ini
```

---

## Teknologi

- **HTML5** — Semantik, ARIA, form validation
- **CSS3** — Custom properties, Grid, Flexbox, animasi, media queries
- **Vanilla JavaScript (ES6+)** — Modules via closure, `localStorage`, `Blob/URL API`, `FileReader API`

---

## Catatan Teknis

- Data disimpan di `localStorage` dengan key `taskflow_v1`
- Tema tersimpan di `taskflow_theme`
- Streak tersimpan di `taskflow_streak`
- Semua input pengguna di-escape untuk mencegah XSS
- Import JSON divalidasi dan disanitasi sebelum digunakan
- LocalStorage yang korup ditangani secara graceful (fallback ke array kosong)

---

*Dibuat untuk Hacktiv8 × IBM Capstone Project — IBM Bob Track*
