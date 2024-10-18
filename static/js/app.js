let uploadedImage = null;
let detectedWords = [];
let wordScales = [];
let marginScale = 5;
let draggedElement = null;

// Listen for the New Upload button click
document.getElementById('newUploadButton').addEventListener('click', handleNewUpload);

function handleNewUpload() {
    // Clear previous extracted words from the webpage
    const predictedWords = document.getElementById('predictedWords');
    predictedWords.innerHTML = ''; // Clear the list

    // Clear the canvas
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Enable file input for new image upload
    document.getElementById('fileInput').click();

    // Disable other buttons until a new image is uploaded
    document.getElementById('detectButton').disabled = true;
    document.getElementById('extractButton').disabled = true;
    document.getElementById('saveExcelButton').disabled = true;
}

// Listen for file upload
document.getElementById('fileInput').addEventListener('change', handleImageUpload);

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) {
        console.log("No file selected.");
        return;
    }

    console.log("Uploaded file type:", file.type);

    // Check if the uploaded file is an image
    if (!file.type.startsWith('image/')) {
        alert('Please upload a valid image file.');
        return; // Exit the function if it's not an image
    }

    const img = new Image();
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        uploadedImage = img;
        detectedWords = [];

        // Enable other buttons after a new image is uploaded
        document.getElementById('detectButton').disabled = false;
        document.getElementById('extractButton').disabled = false;
        document.getElementById('saveExcelButton').disabled = false;
    };

    img.src = URL.createObjectURL(file);
}


// Handle the "Detect Words" button click
document.getElementById('detectButton').addEventListener('click', handleDetection);

async function handleDetection() {
    if (!uploadedImage) return;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(uploadedImage, 0, 0);

    preprocessImage(canvas);

    // Perform CCA + Contour Detection
    const contours = detectContours(canvas);

    // Group contours into lines and merge nearby contours into words
    const mergedWords = groupContoursIntoLinesAndWords(contours, 70, 40);

    detectedWords = mergedWords.map(contour => ({
        bbox: {
            x0: contour.x0,
            y0: contour.y0,
            x1: contour.x1,
            y1: contour.y1
        },
        text: 'Detected Word'
    }));

    wordScales = detectedWords.map(() => ({ width: 1, height: 1 }));
    sortAndRedrawWords();
}

// Handle the "Extract Words" button click for TrOCR
document.getElementById('extractButton').addEventListener('click', async () => {
    if (!uploadedImage) return;

    // Show the loading spinner
    document.getElementById('loading').style.display = 'block';

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < detectedWords.length; i++) {
        const word = detectedWords[i];
        const bbox = word.bbox;

        // Crop each word from the canvas
        const croppedCanvas = document.createElement('canvas');
        const croppedCtx = croppedCanvas.getContext('2d');
        const width = bbox.x1 - bbox.x0;
        const height = bbox.y1 - bbox.y0;
        croppedCanvas.width = width;
        croppedCanvas.height = height;
        croppedCtx.drawImage(canvas, bbox.x0, bbox.y0, width, height, 0, 0, width, height);

        await new Promise(resolve => {
            croppedCanvas.toBlob(async (blob) => {
                // Send the cropped word image to the TrOCR backend
                await sendCroppedWordToBackend(blob, i);
                resolve();
            });
        });
    }

    // Hide the loading spinner once extraction is complete
    document.getElementById('loading').style.display = 'none';
});

document.getElementById('saveExcelButton').addEventListener('click', saveWordsToExcel);

async function saveWordsToExcel() {
    const predictedWords = Array.from(document.querySelectorAll("#predictedWords li")).map(li => {
        // Extract only the actual text and remove the "Original:" or "Correct:" part
        const fullText = li.childNodes[0].textContent;
        const extractedText = fullText.replace(/Original:|Correct:/g, '').trim(); // Remove unwanted labels and trim spaces
        return extractedText;
    });

    // Check if there are no words to save
    if (predictedWords.length === 0) {
        alert("No words to save!");
        return;
    }

    // Send the predicted words to the backend for saving to Excel
    const response = await fetch('/save_to_excel', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ words: predictedWords })
    });

    // Handle the response from the backend
    if (!response.ok) {
        alert('Failed to save words to Excel. Please try again.');
        console.error('Backend error:', response.statusText);
        return;
    }

    const data = await response.json();

    // Check if the backend returned a download URL
    if (data.download_url) {
        const downloadLinkContainer = document.getElementById("downloadLinkContainer");
        downloadLinkContainer.innerHTML = '';

        const downloadLink = document.createElement('a');
        downloadLink.href = data.download_url;
        downloadLink.textContent = "Download your Excel file";
        downloadLink.target = "_blank";
        downloadLink.style.display = 'block';

        downloadLinkContainer.appendChild(downloadLink);
    } else {
        alert('Failed to generate Excel file.');
        console.error('No download_url in response:', data);
    }
}

document.getElementById('deleteExcelContentButton').addEventListener('click', async () => {
    const response = await fetch('/delete_excel_content', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    if (response.ok) {
        alert(data.message);
    } else {
        alert(`Error: ${data.error}`);
    }
});

document.getElementById('deleteExcelFileButton').addEventListener('click', async () => {
    const response = await fetch('/delete_excel_file', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    if (response.ok) {
        alert(data.message);
    } else {
        alert(`Error: ${data.error}`);
    }
});

// Preprocess the image (grayscale + binarization)
function preprocessImage(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = data[i + 1] = data[i + 2] = avg;
    }

    // Apply binarization threshold
    const threshold = 128;
    for (let i = 0; i < data.length; i += 4) {
        const avg = data[i];
        const value = avg > threshold ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = value;
    }

    ctx.putImageData(imageData, 0, 0);
}

// Detect contours using CCA (Connected Component Analysis)
function detectContours(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    const visited = Array(height).fill().map(() => Array(width).fill(false));
    const contours = [];

    function bfs(x, y) {
        const queue = [[x, y]];
        let minX = x, minY = y, maxX = x, maxY = y;

        visited[y][x] = true;

        while (queue.length > 0) {
            const [cx, cy] = queue.shift();
            minX = Math.min(minX, cx);
            minY = Math.min(minY, cy);
            maxX = Math.max(maxX, cx);
            maxY = Math.max(maxY, cy);

            // Check neighboring pixels
            const neighbors = [
                [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]
            ];

            neighbors.forEach(([nx, ny]) => {
                if (nx >= 0 && ny >= 0 && nx < width && ny < height && !visited[ny][nx]) {
                    const index = (ny * width + nx) * 4;
                    if (data[index] === 0) { // Check if it's part of the foreground
                        visited[ny][nx] = true;
                        queue.push([nx, ny]);
                    }
                }
            });
        }

        return { x0: minX, y0: minY, x1: maxX, y1: maxY };
    }

    // Loop through each pixel to find connected components
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            if (data[index] === 0 && !visited[y][x]) { // Black pixel and not visited
                const contour = bfs(x, y);
                // Filter out very small contours (likely noise)
                const contourWidth = contour.x1 - contour.x0;
                const contourHeight = contour.y1 - contour.y0;
                if (contourWidth > 5 && contourHeight > 5) { // Avoid noise
                    contours.push(contour);
                }
            }
        }
    }

    return contours;
}

// Group contours into lines and merge nearby contours into words
function groupContoursIntoLinesAndWords(contours, horizontalThreshold, verticalThreshold) {
    // Group contours by their y-position (to ensure we merge within the same line)
    const lines = [];

    contours.forEach(contour => {
        let addedToLine = false;

        // Check if this contour can be added to an existing line
        for (const line of lines) {
            const [firstInLine] = line;
            if (Math.abs(contour.y0 - firstInLine.y0) <= verticalThreshold) {
                line.push(contour);
                addedToLine = true;
                break;
            }
        }

        // If no suitable line is found, create a new one
        if (!addedToLine) {
            lines.push([contour]);
        }
    });

    // Now merge nearby contours within each line
    const mergedWords = [];

    lines.forEach(line => {
        line.sort((a, b) => a.x0 - b.x0); // Sort line by x position (left to right)

        let currentWord = null;

        line.forEach(contour => {
            if (!currentWord) {
                currentWord = { ...contour };
            } else {
                const distance = contour.x0 - currentWord.x1;
                if (distance <= horizontalThreshold) {
                    // Merge the current contour into the current word
                    currentWord.x1 = Math.max(currentWord.x1, contour.x1);
                    currentWord.y0 = Math.min(currentWord.y0, contour.y0);
                    currentWord.y1 = Math.max(currentWord.y1, contour.y1);
                } else {
                    // Push the current word and start a new one
                    mergedWords.push(currentWord);
                    currentWord = { ...contour };
                }
            }
        });

        if (currentWord) {
            mergedWords.push(currentWord); // Add the last word in the line
        }
    });

    return mergedWords;
}

// Sort boxes from top to bottom, left to right
function sortAndRedrawWords() {
    // Sort by y-coordinate first, and x-coordinate second (top to bottom, left to right)
    detectedWords.sort((a, b) => {
        if (a.bbox.y0 !== b.bbox.y0) {
            return a.bbox.y0 - b.bbox.y0; // Sort by y0 first (top to bottom)
        }
        return a.bbox.x0 - b.bbox.x0; // If y0 is equal, sort by x0 (left to right)
    });

    redrawWords();
}

// Redraw words with current scaling and margin settings
function redrawWords() {
    if (!uploadedImage || detectedWords.length === 0) return;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(uploadedImage, 0, 0);

    detectedWords.forEach((word, index) => {
        const scale = wordScales[index];
        const originalWidth = word.bbox.x1 - word.bbox.x0;
        const originalHeight = word.bbox.y1 - word.bbox.y0;

        const widthIncrease = originalWidth * (scale.width - 1) / 2;
        const x0 = Math.max(0, word.bbox.x0 - widthIncrease - marginScale);
        const x1 = Math.min(canvas.width, word.bbox.x1 + widthIncrease + marginScale);

        const heightIncrease = originalHeight * (scale.height - 1) / 2;
        const y0 = Math.max(0, word.bbox.y0 - heightIncrease - marginScale);
        const y1 = Math.min(canvas.height, word.bbox.y1 + heightIncrease + marginScale);

        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

        // Display the word index above the box
        ctx.font = `${16}px Arial`;
        ctx.fillStyle = 'blue';
        ctx.fillText(index + 1, x0, y0 - 5); // Index is 1-based
    });
}

// Function to send cropped word to backend and process the response
async function sendCroppedWordToBackend(wordImageBlob, wordIndex) {
    const formData = new FormData();
    formData.append('file', wordImageBlob);

    const response = await fetch('/extract', {
        method: 'POST',
        body: formData
    });

    const data = await response.json();

    // Append extracted words to predictedWords
    const predictedWords = document.getElementById('predictedWords');
    const wordItem = document.createElement("li");
    wordItem.textContent = `Original: ${data.predicted_text}`;
    
    const acceptButton = document.createElement("button");
    acceptButton.textContent = "Accept Corrected";
    acceptButton.addEventListener('click', () => {
        wordItem.textContent = `Corrected: ${data.corrected_text}`;
    });
    
    wordItem.appendChild(acceptButton);
    predictedWords.appendChild(wordItem);

    // Call the function to make the new words draggable after appending them
    makeWordsDraggable();

    // Append corrected words to correctedWords
    const correctedWords = document.getElementById('correctedWords');
    const correctedItem = document.createElement("li");
    correctedItem.textContent = `Corrected: ${data.corrected_text}`;
    correctedWords.appendChild(correctedItem);
}

// Function to add draggable functionality to word items
function makeWordsDraggable() {
    const predictedWords = document.querySelectorAll("#predictedWords li");

    predictedWords.forEach((wordItem) => {
        wordItem.setAttribute("draggable", true);

        // Event listeners for drag-and-drop events
        wordItem.addEventListener('dragstart', handleDragStart);
        wordItem.addEventListener('dragover', handleDragOver);
        wordItem.addEventListener('drop', handleDrop);
        wordItem.addEventListener('dragend', handleDragEnd);
    });
}

// Handle the start of dragging
function handleDragStart(event) {
    draggedElement = this; // Store the dragged element
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', this.innerHTML);
    draggedElement.classList.add('dragging');
}

// Handle the dragging over other elements (allows dropping)
function handleDragOver(event) {
    event.preventDefault(); // Necessary to allow dropping
    return false;
}

// Handle the dropping of an element
function handleDrop(event) {
    event.stopPropagation(); // Prevent default behavior

    if (draggedElement !== this) {
        // Swap the HTML content of dragged and dropped elements
        draggedElement.innerHTML = this.innerHTML;
        this.innerHTML = event.dataTransfer.getData('text/html');

        // Optionally, you can swap any other data (like IDs or attributes) if needed
    }

    return false;
}

// Handle the end of dragging (cleanup)
function handleDragEnd(event) {
    draggedElement.classList.remove('dragging'); // Remove the dragging class
    draggedElement = null; // Clear the dragged element
}

// After appending word items to the list, call this function to make them draggable
makeWordsDraggable();

// Add event listener for the "Clear" button
document.getElementById('clearButton').addEventListener('click', handleClear);

function handleClear() {
    // Clear the canvas
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Clear the predicted and corrected words
    document.getElementById('predictedWords').innerHTML = '';
    document.getElementById('correctedWords').innerHTML = '';

    // Reset the detectedWords array
    detectedWords = [];

    // Disable other buttons after clearing the canvas
    document.getElementById('detectButton').disabled = true;
    document.getElementById('extractButton').disabled = true;
    document.getElementById('saveExcelButton').disabled = true;
}

// Newsletter form submission handling
document.getElementById('newsletterForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent the form from submitting the traditional way

    const email = document.getElementById('emailInput').value;
    
    if (email) {
        // Show the thank you message
        document.getElementById('thankYouMessage').style.display = 'block';

        // Clear the email input
        document.getElementById('emailInput').value = '';

        // Optionally, hide the form (you can remove this if you prefer to keep the form visible)
        document.getElementById('newsletterForm').style.display = 'none';
    }
});

// Smooth scroll to About Us and How It Works
document.querySelectorAll('nav a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth'
        });
    });
});

// Carousel functionality
const slides = document.querySelectorAll('.carousel-slide');
const dots = document.querySelectorAll('.carousel-dots button');

dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
        // Remove active class from all slides and dots
        slides.forEach(slide => slide.classList.remove('active'));
        dots.forEach(dot => dot.classList.remove('active'));

        // Add active class to the clicked dot and corresponding slide
        slides[index].classList.add('active');
        dots[index].classList.add('active');
    });
});
