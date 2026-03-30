import fs from "fs";

const text = `
# 🟥 YouTube

---

### 📝 Titel

Dit is de titel.

---

### 📄 Beschrijving

Dit is de beschrijving.

---

### ��️ Hashtags

#crime #station
`;

const sections = text.split(/###\s+(.*)/g).slice(1);
console.log(sections);
