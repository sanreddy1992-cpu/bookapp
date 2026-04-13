# పుస్తక చందా నిర్వహణ వ్యవస్థ
## Book Subscription Management System

---

## 💻 మీ PC లో Run చేయడం (Local)

### Step 1 — Node.js Install
1. https://nodejs.org వెళ్ళండి
2. "LTS" version download చేయండి
3. Install చేయండి

### Step 2 — App Setup
1. ఈ `bookapp` folder ని మీ PC లో ఏదైనా చోట పెట్టండి (ఉదా: C:\bookapp)
2. Command Prompt తెరవండి
3. ఈ commands type చేయండి:

```
cd C:\bookapp
npm install
npm start
```

4. Browser లో తెరవండి: **http://localhost:3000**

### Default Login
- Admin: `admin` / `admin123`
- (Units మీరు Admin నుండి create చేస్తారు)

---

## 🌐 Internet మీద Deploy చేయడం (Render.com - Free)

### Step 1 — GitHub Account
1. https://github.com లో account తయారు చేయండి

### Step 2 — Code Upload
1. https://github.com/new లో new repository తయారు చేయండి
2. Repository పేరు: `bookapp`
3. ఈ files అన్నీ upload చేయండి

### Step 3 — Render.com Deploy
1. https://render.com లో account తయారు చేయండి
2. "New Web Service" click చేయండి
3. GitHub repository connect చేయండి
4. ఈ settings పెట్టండి:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. "Create Web Service" click చేయండి

### Step 4 — అయిపోయింది!
మీకు ఇలాంటి link వస్తుంది:
`https://bookapp-xxxx.onrender.com`

ఈ link అందరికీ share చేయవచ్చు!

---

## 📁 Folder Structure
```
bookapp/
├── server.js          ← Backend (API)
├── package.json       ← Dependencies
├── README.md          ← ఈ file
├── data/              ← Database (auto create అవుతుంది)
│   └── bookapp.db     ← SQLite database
└── public/
    └── index.html     ← Frontend
```

---

## 🔒 Security Notes
- Admin password మార్చాలంటే: server.js లో `admin123` మార్చండి
- Production లో SESSION_SECRET environment variable set చేయండి

---

## ❓ Problems వస్తే
- `node --version` → v18 లేదా అంతకంటే పై version ఉండాలి
- `npm install` error వస్తే → internet connection check చేయండి
- Port 3000 busy అయితే → server.js లో PORT మార్చండి
