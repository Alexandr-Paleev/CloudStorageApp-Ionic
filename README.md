# ☁️ Cloud Storage App - Community Edition

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Demo](https://img.shields.io/badge/Demo-Live-success)](https://cloud-storage-app-ionic-v0.vercel.app)

A modern, **open-source** web application for storing, viewing, and managing files with PWA and mobile device support. Built with Ionic + React + Cloudinary + Supabase.

🔗 **[Live Demo](https://cloud-storage-app-ionic-v0.vercel.app)** | 💎 **[Cloud Storage Pro](#-pro-version)** (coming soon)

> 💎 **Looking for more features?** Check out [Cloud Storage Pro](#-pro-version) with Dropbox, OneDrive, AWS S3, team collaboration, and priority support.

## 📋 Project Description

Cloud Storage App is a full-featured cloud file storage that allows users to:

- Securely store files in the cloud (PDFs, images, documents)
- View and manage files through a user-friendly interface
- Use the app on both web and mobile devices (iOS/Android)
- Automatically expand storage via Google Drive when the limit is exceeded

## ✨ Key Features

### 🔐 Authentication

- ✅ Email/Password registration and login
- ✅ Google Account sign-in
- ✅ Protected routes (authorized users only)

### 📁 File Management

- ✅ File upload with progress indicator
- ✅ User file list view
- ✅ PDF and image preview
- ✅ File deletion (with full removal from Cloudinary)
- ✅ File renaming
- ✅ Metadata display (size, upload date, type)

### 💾 Storage

- ✅ **500 MB** free storage per user (Cloudinary)
- ✅ Automatic Google Drive connection when the limit is exceeded
- ✅ Visual storage usage indicator (progress bar)
- ✅ Tracking total size of all uploaded files

### 📱 Platforms

- ✅ **Web** — works in any modern browser
- ✅ **PWA** — can be installed as an app on phone/computer (Service Worker + offline support)
- ✅ **iOS/Android** — native app support via Capacitor

> 📱 **PWA Ready!** Install the app on your device: [Testing Guide](PWA_TESTING.md)

### 🎨 Interface

- ✅ Responsive design (works on all screen sizes)
- ✅ Modern UI based on Ionic components
- ✅ Dark/light theme support (system settings)
- ✅ Smooth animations and transitions

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Cloudinary Configuration
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
VITE_CLOUDINARY_API_KEY=your_api_key
VITE_CLOUDINARY_UPLOAD_PRESET=your_upload_preset_name

# Required: API endpoint for file deletion
VITE_CLOUDINARY_DELETE_API_URL=https://your-project.vercel.app/api/cloudinary/delete

# Optional: Google Drive (for extra storage)
VITE_GOOGLE_CLIENT_ID=your_google_client_id

# Optional: Analytics (production only)
VITE_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_HOTJAR_SITE_ID=1234567
VITE_HOTJAR_VERSION=6
```

### 3. Service Setup

#### Supabase

1. Create a project on [Supabase.com](https://supabase.com/)
2. Run the schema from `SUPABASE_SCHEMA.sql` in the SQL Editor.
3. Enable **Google Auth** in Authentication -> Providers if needed.
4. Set up a private bucket named `files` in Storage.

#### Cloudinary

1. Register on [Cloudinary](https://cloudinary.com/users/register/free)
2. Create an **Upload Preset**:
   - Settings → Upload → Upload presets → Add upload preset
   - Preset name: `cloud-storage-app` (or any other)
   - Signing mode: `Unsigned`
   - Asset folder: leave empty
3. Enable PDF delivery: Settings → Security → Allow delivery of PDF and ZIP files

#### Vercel API (for file deletion)

1. Register on [Vercel](https://vercel.com/)
2. Connect your Git repository
3. Add environment variables in Vercel:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
4. After deployment, copy the API URL and add it to `.env`:
   - `VITE_CLOUDINARY_DELETE_API_URL=https://your-project.vercel.app/api/cloudinary/delete`

#### Google Drive (optional)

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable Google Drive API
3. Create OAuth 2.0 Client ID
4. Add `VITE_GOOGLE_CLIENT_ID` to `.env`

#### Analytics (optional)

Analytics are automatically enabled in production when environment variables are set.

**Google Analytics 4:**
1. Create a property in [Google Analytics](https://analytics.google.com/)
2. Get your Measurement ID (starts with `G-`)
3. Add `VITE_GA4_MEASUREMENT_ID` to `.env`

**Hotjar:**
1. Create a site in [Hotjar](https://www.hotjar.com/)
2. Get your Site ID from the tracking code
3. Add `VITE_HOTJAR_SITE_ID` to `.env`

> **Privacy First**: Hotjar only runs on web (not native mobile apps). File names and sensitive data are automatically masked using `data-hj-suppress` attributes.

### 4. Run Application

```bash
# Development mode
npm run dev

# Production build
npm run build

# Preview build
npm run preview
```

The app will be available at: `http://localhost:5173`

## 📦 Tech Stack

- **UI Framework**: Ionic React 8.0
- **Frontend**: React 18 + TypeScript
- **File Storage**: Cloudinary (25 GB free) & Supabase Storage (PDFs)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **State Management**: TanStack Query + React Context API
- **Routing**: React Router DOM
- **Build**: Vite + Capacitor
- **Backend API**: Vercel Functions
- **Analytics**: Google Analytics 4 (GA4) + Hotjar
- **Error Tracking**: Sentry

## 🚀 Deployment

### Vercel (recommended)

1. Install Vercel CLI: `npm install -g vercel`
2. Deploy: `vercel --prod`

## 📱 Mobile App Publication

### Android

```bash
# Build web app
npm run build

# Add Android platform
npx cap add android

# Open in Android Studio
npx cap open android
```

In Android Studio, build APK or AAB for Google Play Store.

### iOS

```bash
# Add iOS platform
npx cap add ios

# Open in Xcode
npx cap open ios
```

**Requirements**: Mac with Xcode installed and an Apple Developer account ($99/year).

## 📁 Project Structure

```
cloud-storage-app/
├── src/
│   ├── pages/
│   │   ├── Login.tsx              # Login/Register page
│   │   ├── Dashboard.tsx          # User file list
│   │   ├── Upload.tsx             # File upload page
│   │   └── FileView.tsx           # File view/manage page
│   ├── services/
│   │   ├── auth.service.ts        # Authentication service
│   │   ├── storage.service.ts     # Main file service
│   │   ├── cloudinary.service.ts  # Cloudinary service
│   │   ├── googledrive-auth.service.ts  # Google Drive OAuth
│   │   └── googledrive.service.ts # Google Drive service
│   ├── providers/
│   │   ├── storage.provider.ts    # Storage Provider architecture
│   │   └── impl/                  # Provider implementations
│   ├── contexts/
│   │   └── AuthContext.tsx        # Authentication context
│   ├── components/
│   │   ├── PrivateRoute.tsx       # Protected route component
│   │   └── PageViewTracker.tsx    # Analytics page view tracker
│   ├── hooks/
│   │   └── useAnalytics.ts        # GA4 + Hotjar analytics hook
│   ├── types/
│   │   └── analytics.types.ts     # Analytics event types
│   ├── supabase/
│   │   └── supabase.config.ts     # Supabase configuration
│   ├── App.tsx                    # Main component
│   └── main.tsx                   # Entry point
├── api/
│   └── cloudinary/
│       └── delete.ts              # Vercel Function for deletion
├── capacitor.config.ts            # Capacitor config
├── vite.config.ts                 # Vite config
└── package.json
```

## 🔒 Limits and Restrictions

### Application

- **Max storage per user**: 500 MB in Cloudinary (default)
- **Extra storage**: Google Drive (15 GB free) — auto-connects when limit is reached
- **Max single file size**: 50 MB

### Cloudinary (Free Plan)

- **Storage**: 25 GB
- **Bandwidth**: 25 GB/month
- **Transformations**: 25,000/month

### Supabase (Free Tier)

- **Database**: 500MB
- **Storage**: 1GB (5GB bandwidth)

## 🛠️ Development

```bash
# Linting
npm run lint

# Code formatting
npm run format
```

## 💎 Pro Version

**Cloud Storage Pro** is a premium version with enterprise features:

### Additional Features in Pro:

- 🔗 **Dropbox Integration** - sync with Dropbox
- 🔗 **OneDrive Integration** - Microsoft cloud storage
- 🔗 **AWS S3 Support** - enterprise-grade storage
- 👥 **Team Collaboration** - share files with team members
- 📊 **Advanced Analytics** - detailed usage statistics
- 🎨 **White-Label** - custom branding for your business
- ⚡ **Priority Support** - dedicated technical assistance
- 🚀 **Unlimited Storage** - no limits on file uploads

**Coming Soon!** Stay tuned for the Pro version launch.

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please read our [Code Style Guide](https://github.com/aleksandrpaleev/CloudStorageApp-Ionic#code-style) before contributing.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Support

- 💬 **Issues**: [GitHub Issues](https://github.com/aleksandrpaleev/CloudStorageApp-Ionic/issues)
- 📧 **Email**: support@cloudstorage.app (for Pro customers)

## 📄 Legal

- **[Privacy Policy](PRIVACY_POLICY.md)** - How we handle your data
- **[Terms of Service](TERMS_OF_SERVICE.md)** - Rules and guidelines

## 🌟 Star History

If you find this project useful, please give it a ⭐ on GitHub!

---

**Created with ❤️ by Aleksandr Paleev**

**Stack**: Ionic + React + TypeScript + Supabase + Cloudinary + Vercel
