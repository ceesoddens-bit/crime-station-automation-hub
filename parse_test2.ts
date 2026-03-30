const text = `
# �� YouTube

---

### 📝 Titel

Dit is de titel.

---

### 📄 Beschrijving

Dit is de beschrijving met --- erin.

---

### 🏷️ Hashtags

#crime #station
`;

const parts = text.split(/###\s+(.*)/g);
const sections = [];
for (let i = 1; i < parts.length; i += 2) {
  sections.push({
    title: parts[i],
    content: parts[i + 1].replace(/---/g, '').trim()
  });
}
console.log(sections);
