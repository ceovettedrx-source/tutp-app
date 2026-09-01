# Tut-P Demo — Google Cloud Run Deploy Instructions (తెలుగు)

ఇది YC application తో పాటు attach చేయగల, నిజంగా పనిచేసే Tut-P demo. ఇందులో:
- `server.js` — మీ Anthropic API key ను safe గా server మీద దాచి, Claude కి calls చేసే చిన్న Node.js backend
- `public/index.html` — Family setup + homework input + AI explanation/quiz UI
- `Dockerfile` — Cloud Run build కోసం config

**ఈ app ఎప్పుడూ Google Cloud Run మీద మాత్రమే deploy అవుతుంది — Fly.io కాదు.**

## Step 1 — Node.js ఉందో లేదో చెక్ చేయండి

టెర్మినల్/కమాండ్ ప్రాంప్ట్ తెరిచి:
```
node -v
```
ఏదైనా వెర్షన్ (v18 లేదా ఆపైన) కనిపిస్తే సరిపోతుంది. లేకపోతే https://nodejs.org నుంచి ఇన్‌స్టాల్ చేసుకోండి (LTS వెర్షన్).

## Step 2 — Google Cloud CLI (`gcloud`) ఇన్‌స్టాల్ చేయండి

https://cloud.google.com/sdk/docs/install నుంచి ఇన్‌స్టాల్ చేసుకోండి, ఆపై టెర్మినల్ మూసి మళ్ళీ తెరవండి.

## Step 3 — Google Cloud లో లాగిన్ అవ్వండి

```
gcloud auth login
```
ఇది బ్రౌజర్ తెరుస్తుంది — signup/login చేయండి. ఆపై ఏ project వాడాలో సెట్ చేయండి:
```
gcloud config set project YOUR_PROJECT_ID
```

## Step 4 — ఈ ఫోల్డర్‌లోకి వెళ్లండి

ఈ మొత్తం ఫోల్డర్‌ను (`tutp-app`) డౌన్‌లోడ్ చేసుకున్నాక, టెర్మినల్‌లో:
```
cd path/to/tutp-app
```

## Step 5 — మీ Anthropic API key తో పాటు Deploy చేయండి

**⚠️ ముఖ్యం:** API key ను ఎప్పుడూ `.env` ఫైల్‌లో పెట్టి deploy చేయకండి — అది git/build లో బయటపడే ప్రమాదం ఉంది. బదులుగా `--set-env-vars` (లేదా Secret Manager) వాడండి:

```
gcloud run deploy tutp-demo --source . --region=us-central1 --set-env-vars ANTHROPIC_API_KEY=your_actual_api_key_here
```

(మీ API key console.anthropic.com లో దొరుకుతుంది.)

ఇది కొన్ని నిమిషాలు పడుతుంది (build + upload). పూర్తయ్యాక ఒక `*.run.app` URL ఇస్తుంది. ఈ లింక్ తెరిచి టెస్ట్ చేయండి — Health check కోసం `/health` కూడా చెక్ చేయొచ్చు.

## Step 6 (ఆప్షనల్) — మీ సొంత domain కనెక్ట్ చేయడం

```
gcloud run domain-mappings create --service tutp-demo --domain yourdomain.com --region=us-central1
```
ఇది మీకు కొన్ని DNS records చూపిస్తుంది — వాటిని మీ domain registrar దగ్గర "DNS settings" లో యాడ్ చేయాలి. కొన్ని గంటల్లో propagate అవుతుంది.

## ఏదైనా error వస్తే?

Error message ను కాపీ చేసి నాకు (Claude కి) పేస్ట్ చేయండి — నేను ఏం తప్పు జరిగిందో చూసి ఫిక్స్ చేయడంలో సహాయం చేస్తాను.

## Update చేయాలంటే

Code లో ఏదైనా మార్చినప్పుడు, మళ్ళీ deploy చేయడానికి:
```
gcloud run deploy tutp-demo --source . --region=us-central1
```
అంతే — ఒక్క command (ఇప్పటికే సెట్ అయిన env vars అలానే ఉంటాయి, మళ్ళీ పాస్ చేయాల్సిన అవసరం లేదు).
