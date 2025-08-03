# Simple Image Editor

A simple, browser-based image editor with annotation tools, HEIC support, and intuitive shape manipulation.

## 🌟 Features

### 📁 **Image Support**
- **Standard formats**: JPEG, PNG, GIF, WebP
- **HEIC/HEIF support**: iPhone photos work seamlessly
- **Automatic conversion**: HEIC files are converted to JPEG in your browser
- **Privacy-focused**: No files uploaded to servers

### 🎨 **Drawing Tools**
- **Rectangle**: Click and drag to draw rectangles
- **Ellipse**: Click and drag to draw circles/ovals
- **Arrow**: Click and drag to draw arrows with arrowheads
- **Text**: Click anywhere to add text annotations

### ✨ **Selection & Manipulation**
- **Select tool**: Click to select shapes
- **Drag & drop**: Move selected shapes by dragging
- **Rotation handles**: Rotate shapes and text with the green handle
- **Shape cycling**: Click multiple times on overlapping shapes to cycle through them
- **Smart selection**: Drag to move, click to cycle

### ⌨️ **Keyboard Shortcuts**
- **Ctrl+Z (or Cmd+Z)**: Undo last action
- **Delete/Backspace**: Delete selected shape
- **Escape**: Deselect current shape

### 🛠️ **Tools & Controls**
- **Color picker**: Choose any color for your annotations
- **Size slider**: Adjust line thickness (1-20px)
- **Undo button**: Remove last shape added
- **Delete button**: Remove selected shape
- **Clear button**: Remove all annotations (keeps image)
- **Download**: Save your edited image as PNG

## 🚀 Getting Started

### **Loading Images**
1. Click the file input button
2. Select any image file (JPEG, PNG, GIF, WebP, HEIC)
3. The image will load and scale to fit the canvas
4. For HEIC files, conversion happens automatically

### **Adding Annotations**
1. **Select a tool** from the toolbar:
   - **Select**: For moving and editing existing shapes
   - **Rectangle**: Draw rectangles
   - **Ellipse**: Draw circles/ovals
   - **Arrow**: Draw arrows
   - **Text**: Add text labels

2. **Choose your settings**:
   - Pick a color using the color picker
   - Adjust line thickness with the size slider

3. **Draw your shapes**:
   - **Rectangle/Ellipse/Arrow**: Click and drag to draw
   - **Text**: Click where you want text, then type in the prompt

### **Editing Shapes**

#### **Selecting Shapes**
- Click on any shape to select it
- Selected shapes show with a green dashed border
- If shapes overlap, click multiple times to cycle through them

#### **Moving Shapes**
- Select a shape, then drag it to move
- The shape follows your mouse cursor

#### **Rotating Shapes**
- Select a shape to see the green rotation handle
- Drag the green handle to rotate the shape
- A dashed line shows the rotation center

#### **Deleting Shapes**
- Select a shape, then press **Delete** or **Backspace**
- Or use the **Delete** button in the toolbar

### **Managing Your Work**
- **Undo**: Press **Ctrl+Z** or use the **Undo** button
- **Clear**: Use the **Clear** button to remove all annotations
- **Download**: Click **Download** to save your work as a PNG file

## 🎯 **Pro Tips**

### **Working with Overlapping Shapes**
- **First click**: Selects the topmost shape
- **Subsequent clicks**: Cycle through all shapes at that point
- **Drag to move**: If you drag after clicking, it moves the shape instead of cycling

### **HEIC Files**
- **iPhone photos**: Work perfectly - just select and load
- **Automatic conversion**: Happens in your browser, no upload needed
- **Quality**: High-quality JPEG conversion
- **Troubleshooting**: If HEIC doesn't work, try refreshing the page

### **Keyboard Workflow**
1. **Ctrl+Z**: Undo mistakes quickly
2. **Delete**: Remove unwanted shapes
3. **Click + Drag**: Move shapes precisely
4. **Click + Click**: Cycle through overlapping shapes

### **Responsive Design**
- **Full height**: Editor uses most of your screen
- **Auto-resize**: Canvas adjusts to your window size
- **Mobile-friendly**: Works on tablets and phones

## 🔧 **Technical Details**

### **Browser Compatibility**
- **Chrome**: Full support
- **Firefox**: Full support
- **Safari**: Full support
- **Edge**: Full support
- **Mobile browsers**: Works on iOS Safari and Chrome Mobile

### **HEIC Support**
- Uses the `heic2any` library for client-side conversion
- No server processing required
- Maintains image quality during conversion

### **Canvas Features**
- **Responsive scaling**: Images automatically fit the canvas
- **Coordinate conversion**: Handles different screen densities
- **Smooth drawing**: Real-time preview while drawing

## 🐛 **Troubleshooting**

### **HEIC Files Not Loading**
1. **Refresh the page** and try again
2. **Check JavaScript**: Make sure JavaScript is enabled
3. **Try a different file**: Some HEIC files may be corrupted
4. **Use a modern browser**: Chrome, Firefox, Safari, or Edge

### **Shapes Not Selecting**
1. **Make sure you're in Select mode** (first radio button)
2. **Click directly on the shape** (not the background)
3. **Try clicking multiple times** if shapes overlap

### **Rotation Not Working**
1. **Select the shape first** (green border should appear)
2. **Look for the green handle** (small circle with dashed line)
3. **Drag the handle** to rotate

### **Download Not Working**
1. **Check browser permissions** for file downloads
2. **Try a different browser** if the issue persists
3. **Make sure you have an image loaded**

## 📝 **File Structure**
```
image_editor/
├── index.html          # Main application file
└── README.md          # This file
```

## 🎨 **Customization**

The editor is built as a single HTML file with embedded CSS and JavaScript. To customize:

- **Colors**: Modify the CSS variables in the `<style>` section
- **Tools**: Add new drawing tools in the JavaScript section
- **Shortcuts**: Modify the keyboard event handlers
- **UI**: Adjust the HTML structure and CSS styling

## 📄 **License**

This is a simple, open-source image editor. Feel free to use, modify, and distribute as needed.

---

**Happy editing!** 🎨✨
