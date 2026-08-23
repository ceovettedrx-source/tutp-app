# Tut-P Demo — Fly.io Deploy Instructions (తెలుగు)

ఇది YC application తో పాటు attach చేయగల, నిజంగా పనిచేసే Tut-P demo. ఇందులో:
- `server.js` — మీ Anthropic API key ను safe గా server మీద దాచి, Claude కి calls చేసే చిన్న Node.js backend
- `public/index.html` — Family setup + homework input + AI explanation/quiz UI
- `fly.toml`, `Dockerfile` — Fly.io deploy కోసం config

## Step 1 — Node.js ఉందో లేదో చెక్ చేయండి

టెర్మినల్/కమాండ్ ప్రాంప్ట్ తెరిచి:
```
node -v
```
ఏదైనా వెర్షన్ (v18 లేదా ఆపైన) కనిపిస్తే సరిపోతుంది. లేకపోతే https://nodejs.org నుంచి ఇన్‌స్టాల్ చేసుకోండి (LTS వెర్షన్).

## Step 2 — Fly.io CLI ఇన్‌స్టాల్ చేయండి

**Mac/Linux:**
```
curl -L https://fly.io/install.sh | sh
```
**Windows (PowerShell):**
```
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

ఇన్‌స్టాల్ అయ్యాక టెర్మినల్ మూసి మళ్ళీ తెరవండి.

## Step 3 — Fly.io లో లాగిన్ అవ్వండి

```
fly auth login
```
ఇది బ్రౌజర్ తెరుస్తుంది — signup/login చేయండి (ఫ్రీ అకౌంట్, కార్డ్ అవసరం లేకుండా చిన్న apps run చేయొచ్చు).

## Step 4 — ఈ ఫోల్డర్‌లోకి వెళ్లండి

ఈ మొత్తం ఫోల్డర్‌ను (`tutp-app`) డౌన్‌లోడ్ చేసుకున్నాక, టెర్మినల్‌లో:
```
cd path/to/tutp-app
```

## Step 5 — App ను లాంచ్ చేయండి

```
fly launch
```
ఇది కొన్ని ప్రశ్నలు అడుగుతుంది:
- App name — ఏదైనా పేరు ఇవ్వండి (ఉదా: `tutp-demo-yourname`), ఖాళీగా వదిలేస్తే random పేరు ఇస్తుంది
- Region — Mumbai (bom) select చేయండి, లేదా default వదిలేయండి
- "Would you like to set up a Postgres database?" → **No**
- "Would you like to set up Redis?" → **No**
- "Would you like to deploy now?" → **No** (ముందు API key సెట్ చేద్దాం)

## Step 6 — మీ Anthropic API key ను సురక్షితంగా సెట్ చేయండి

**⚠️ ముఖ్యం:** API key ను ఎప్పుడూ `.env` ఫైల్‌లో పెట్టి deploy చేయకండి — అది git/build లో బయటపడే ప్రమాదం ఉంది. బదులుగా Fly.io యొక్క secure secrets ఫీచర్ వాడండి:

```
fly secrets set ANTHROPIC_API_KEY=your_actual_api_key_here
```

(మీ API key console.anthropic.com లో దొరుకుతుంది.)

## Step 7 — Deploy చేయండి

```
fly deploy
```
ఇది కొన్ని నిమిషాలు పడుతుంది (build + upload). పూర్తయ్యాక ఒక URL ఇస్తుంది — ఇలా:
```
https://tutp-demo-yourname.fly.dev
```
ఈ లింక్ తెరిచి టెస్ట్ చేయండి — Health check కోసం `/health` కూడా చెక్ చేయొచ్చు.

## Step 8 (ఆప్షనల్) — మీ సొంత domain కనెక్ట్ చేయడం

Domain తీసుకున్నాక:
```
fly certs add yourdomain.com
```
ఇది మీకు కొన్ని DNS records (A/AAAA లేదా CNAME) చూపిస్తుంది — వాటిని మీ domain registrar (GoDaddy/Namecheap మొదలైనవి) దగ్గర "DNS settings" లో యాడ్ చేయాలి. కొన్ని గంటల్లో propagate అవుతుంది.

## ఏదైనా error వస్తే?

Error message ను కాపీ చేసి నాకు (Claude కి) పేస్ట్ చేయండి — నేను ఏం తప్పు జరిగిందో చూసి ఫిక్స్ చేయడంలో సహాయం చేస్తాను.

## Update చేయాలంటే

Code లో ఏదైనా మార్చినప్పుడు, మళ్ళీ deploy చేయడానికి:
```
fly deploy
```
అంతే — ఒక్క command.
