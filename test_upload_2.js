import FormData from 'form-data';
import fetch from 'node-fetch';
import fs from 'fs';

async function run() {
  fs.writeFileSync('dummy.mp3', 'dummy');
  const form = new FormData();
  form.append('series', 'Crime Insight');
  form.append('media', fs.createReadStream('dummy.mp3'));
  
  try {
    const response = await fetch('http://localhost:3000/api/process', {
      method: 'POST',
      body: form
    });
    const text = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', text);
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}
run();
