/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Camera, 
  Shirt, 
  Users, 
  LayoutDashboard, 
  Image as ImageIcon,
  Wand2,
  Download,
  Plus,
  CheckCircle2,
  Loader2,
  UploadCloud,
  Coins,
  History,
  Scissors
} from 'lucide-react';
import { generateVirtualTryOnImage, generatePoseVariation, generateModelImage, generateGarmentColorVariation, generateHairstyleTryOnImage } from './services/geminiService';
import { defaultWardrobe, defaultHairstyles } from './wardrobe';
import { WardrobeItem, HistoryItem } from './types';
import { getFriendlyErrorMessage } from './lib/utils';

const urlToFile = (url: string, filename: string): Promise<File> => {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.setAttribute('crossOrigin', 'anonymous');
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Could not get canvas context.'));
            ctx.drawImage(image, 0, 0);
            canvas.toBlob((blob) => {
                if (!blob) return reject(new Error('Canvas toBlob failed.'));
                const mimeType = blob.type || 'image/png';
                const file = new File([blob], filename, { type: mimeType });
                resolve(file);
            }, 'image/png');
        };
        image.onerror = (error) => reject(new Error(`Could not load image from URL. Error: ${error}`));
        image.src = url;
    });
};

interface PoseOption {
  id: string;
  label: string;
  instruction: string;
  thumbnail: string;
}

const POSE_OPTIONS: PoseOption[] = [
  {
    id: "frontal",
    label: "Frontal View",
    instruction: "Full frontal view, professional fashion pose",
    thumbnail: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=300&h=400&fit=crop&q=80"
  },
  {
    id: "three-quarter",
    label: "3/4 View",
    instruction: "Slightly turned, 3/4 view, elegant posture",
    thumbnail: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=400&fit=crop&q=80"
  },
  {
    id: "side",
    label: "Side Profile",
    instruction: "Side profile view, looking away",
    thumbnail: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=300&h=400&fit=crop&q=80"
  },
  {
    id: "walking",
    label: "Walking",
    instruction: "Walking towards camera, dynamic fashion runway look",
    thumbnail: "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=300&h=400&fit=crop&q=80"
  },
  {
    id: "leaning",
    label: "Leaning",
    instruction: "Leaning against a wall, casual editorial style",
    thumbnail: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=300&h=400&fit=crop&q=80"
  },
  {
    id: "sitting",
    label: "Sitting",
    instruction: "Sitting on a stool, relaxed but fashionable",
    thumbnail: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&h=400&fit=crop&q=80"
  },
  {
    id: "hands-in-pockets",
    label: "In Pockets",
    instruction: "Standing with hands in pockets, confident look",
    thumbnail: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=300&h=400&fit=crop&q=80"
  },
  {
    id: "looking-over-shoulder",
    label: "Over Shoulder",
    instruction: "Looking over the shoulder, dramatic lighting",
    thumbnail: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=300&h=400&fit=crop&q=80"
  }
];

const PRESET_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Black', value: '#171717' },
  { name: 'White', value: '#ffffff' },
];

interface ModelItem {
  id: string;
  name: string;
  url: string;
  processedUrl?: string;
}

interface GeneratedResult {
  pose: string;
  url: string;
}

type GenerationStep = 'idle' | 'uploading' | 'preparing' | 'applying' | 'posing' | 'finalizing';

const defaultModels: ModelItem[] = [
  { 
    id: 'm1', 
    name: 'Studio Model 1', 
    url: 'https://storage.googleapis.com/gemini-95-icons/asr-tryon-model.png', 
    processedUrl: 'https://storage.googleapis.com/gemini-95-icons/asr-tryon-model.png' 
  }
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'studio' | 'models' | 'garments' | 'hairstyles' | 'history'>('studio');
  const [studioMode, setStudioMode] = useState<'clothing' | 'hairstyle'>('clothing');
  
  const [models, setModels] = useState<ModelItem[]>(defaultModels);
  const [garments, setGarments] = useState<WardrobeItem[]>(defaultWardrobe);
  const [hairstyles, setHairstyles] = useState<WardrobeItem[]>(defaultHairstyles);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [selectedModelId, setSelectedModelId] = useState<string | null>(defaultModels[0].id);
  const [selectedGarmentId, setSelectedGarmentId] = useState<string | null>(null);
  const [selectedHairstyleId, setSelectedHairstyleId] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [coloredGarmentUrl, setColoredGarmentUrl] = useState<string | null>(null);
  const [isGeneratingColor, setIsGeneratingColor] = useState(false);
  const [customColor, setCustomColor] = useState('#ff0000');
  const [selectedPoses, setSelectedPoses] = useState<string[]>([POSE_OPTIONS[0].instruction]);

  const [generatedImages, setGeneratedImages] = useState<GeneratedResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState<GenerationStep>('idle');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<number>(20);

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      if (credits < 1) {
        setError("Not enough credits to process a new model. You need 1 credit.");
        return;
      }

      const file = e.target.files[0];
      const tempUrl = URL.createObjectURL(file);
      const newModel: ModelItem = {
        id: `model-${Date.now()}`,
        name: file.name,
        url: tempUrl,
      };
      setModels(prev => [...prev, newModel]);
      
      // Process the model to get a clean studio version
      setIsGenerating(true);
      setGenerationStep('uploading');
      setLoadingMessage('Processing model for studio use...');
      setCredits(prev => prev - 1);

      try {
        const processedUrl = await generateModelImage(file);
        setModels(prev => prev.map(m => m.id === newModel.id ? { ...m, processedUrl } : m));
      } catch (err) {
        setCredits(prev => prev + 1); // Refund
        setError(getFriendlyErrorMessage(err, 'Failed to process model'));
      } finally {
        setIsGenerating(false);
        setGenerationStep('idle');
        setLoadingMessage('');
      }
    }
  };

  const handleGarmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const newGarment: WardrobeItem = {
        id: `garment-${Date.now()}`,
        name: file.name,
        url: URL.createObjectURL(file),
      };
      setGarments(prev => [...prev, newGarment]);
    }
  };

  const handleHairstyleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const newHairstyle: WardrobeItem = {
        id: `hairstyle-${Date.now()}`,
        name: file.name,
        url: URL.createObjectURL(file),
      };
      setHairstyles(prev => [...prev, newHairstyle]);
    }
  };

  const handleColorSelect = async (color: string) => {
    if (!selectedGarmentId) return;
    if (credits < 1) {
      setError("Not enough credits to generate a color variation. You need 1 credit.");
      return;
    }

    setSelectedColor(color);
    setIsGeneratingColor(true);
    setError(null);
    setCredits(prev => prev - 1);

    try {
      const garment = garments.find(g => g.id === selectedGarmentId);
      if (!garment) throw new Error("Garment not found");
      const garmentFile = await urlToFile(garment.url, garment.name);
      const newUrl = await generateGarmentColorVariation(garmentFile, color);
      setColoredGarmentUrl(newUrl);
    } catch (err) {
      setCredits(prev => prev + 1); // Refund
      setError(getFriendlyErrorMessage(err, 'Failed to generate color variation'));
      setSelectedColor(null);
    } finally {
      setIsGeneratingColor(false);
    }
  };

  const togglePose = (pose: string) => {
    setSelectedPoses(prev => {
      if (prev.includes(pose)) {
        if (prev.length === 1) return prev; // Keep at least one selected
        return prev.filter(p => p !== pose);
      }
      return [...prev, pose];
    });
  };

  const handleGenerate = async () => {
    if (!selectedModelId || selectedPoses.length === 0) return;
    if (studioMode === 'clothing' && !selectedGarmentId) return;
    if (studioMode === 'hairstyle' && !selectedHairstyleId) return;
    
    const cost = selectedPoses.length;
    if (credits < cost) {
      setError(`Not enough credits. You need ${cost} credits to generate these images.`);
      return;
    }

    const model = models.find(m => m.id === selectedModelId);
    const garment = garments.find(g => g.id === selectedGarmentId);
    const hairstyle = hairstyles.find(h => h.id === selectedHairstyleId);
    
    if (!model || !model.processedUrl) return;
    if (studioMode === 'clothing' && !garment) return;
    if (studioMode === 'hairstyle' && !hairstyle) return;

    setIsGenerating(true);
    setError(null);
    setGeneratedImages([]);
    setGenerationStep('preparing');
    setLoadingMessage('Preparing image assets...');
    setCredits(prev => prev - cost);
    
    try {
      let modelDataUrl = model.processedUrl;
      if (!modelDataUrl.startsWith('data:')) {
        const modelFile = await urlToFile(modelDataUrl, model.name);
        modelDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(modelFile);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
        });
      }

      setGenerationStep('applying');
      let tryOnUrl = '';

      if (studioMode === 'clothing') {
        setLoadingMessage('Applying garment to model...');
        const garmentFile = await urlToFile(coloredGarmentUrl || garment!.url, garment!.name);
        tryOnUrl = await generateVirtualTryOnImage(modelDataUrl, garmentFile);
      } else {
        setLoadingMessage('Applying hairstyle to model...');
        const hairstyleFile = await urlToFile(hairstyle!.url, hairstyle!.name);
        tryOnUrl = await generateHairstyleTryOnImage(modelDataUrl, hairstyleFile);
      }
      
      setGenerationStep('posing');
      setLoadingMessage(`Generating ${selectedPoses.length} pose variation(s)...`);
      
      // Then, generate all selected poses concurrently
      const results = await Promise.all(selectedPoses.map(async (pose) => {
        if (pose === POSE_OPTIONS[0].instruction) {
          return { pose, url: tryOnUrl };
        } else {
          const posedUrl = await generatePoseVariation(tryOnUrl, pose);
          return { pose, url: posedUrl };
        }
      }));

      setGenerationStep('finalizing');
      setLoadingMessage('Finalizing images...');
      await new Promise(resolve => setTimeout(resolve, 600));

      setGeneratedImages(results);
      
      const newHistoryItems: HistoryItem[] = results.map((r, index) => ({
        id: `hist-${Date.now()}-${index}`,
        url: r.url,
        pose: r.pose,
        timestamp: Date.now()
      }));
      setHistory(prev => [...newHistoryItems, ...prev]);
    } catch (err) {
      setCredits(prev => prev + selectedPoses.length); // Refund
      setError(getFriendlyErrorMessage(err, 'Generation failed'));
    } finally {
      setIsGenerating(false);
      setGenerationStep('idle');
      setLoadingMessage('');
    }
  };

  const downloadImage = (url: string, poseName: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `lumina-studio-${poseName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-gray-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Camera className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">Lumina Studio</span>
        </div>
        
        <nav className="flex-1 px-4 space-y-1">
          <button 
            onClick={() => setActiveTab('studio')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${activeTab === 'studio' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Wand2 className="w-5 h-5" />
            Photo Studio
          </button>
          <button 
            onClick={() => setActiveTab('models')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${activeTab === 'models' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Users className="w-5 h-5" />
            Models Library
          </button>
          <button 
            onClick={() => setActiveTab('garments')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${activeTab === 'garments' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Shirt className="w-5 h-5" />
            Garments Library
          </button>
          <button 
            onClick={() => setActiveTab('hairstyles')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${activeTab === 'hairstyles' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Scissors className="w-5 h-5" />
            Hairstyles Library
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${activeTab === 'history' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <History className="w-5 h-5" />
            History
          </button>
        </nav>
        
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="User" />
            </div>
            <div className="text-sm">
              <p className="font-medium">Admin User</p>
              <div className="flex items-center gap-1 text-indigo-600 font-medium text-xs mt-0.5 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">
                <Coins className="w-3 h-3" />
                {credits} Credits
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-8 justify-between shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold capitalize">{activeTab.replace('-', ' ')}</h1>
            {activeTab === 'studio' && (
              <div className="flex bg-gray-100 p-1 rounded-lg ml-4">
                <button
                  onClick={() => setStudioMode('clothing')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${studioMode === 'clothing' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Clothing
                </button>
                <button
                  onClick={() => setStudioMode('hairstyle')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${studioMode === 'hairstyle' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Hairstyles
                </button>
              </div>
            )}
          </div>
          {activeTab === 'studio' && (
            <button 
              onClick={handleGenerate}
              disabled={isGenerating || !selectedModelId || (studioMode === 'clothing' && !selectedGarmentId) || (studioMode === 'hairstyle' && !selectedHairstyleId) || selectedPoses.length === 0 || credits < selectedPoses.length}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Generate {selectedPoses.length} Image{selectedPoses.length !== 1 ? 's' : ''} ({selectedPoses.length} <Coins className="w-4 h-4 inline" />)
            </button>
          )}
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-start gap-3">
              <div className="mt-0.5">⚠️</div>
              <div>
                <h3 className="font-semibold">Error</h3>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          {activeTab === 'studio' && (
            <div className="flex flex-col lg:flex-row gap-8 h-full">
              {/* Left Column: Settings */}
              <div className="w-full lg:w-1/3 space-y-8">
                {/* Model Selection */}
                <section>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">1. Select Model</h2>
                  <div className="grid grid-cols-3 gap-3">
                    {models.map(model => (
                      <button
                        key={model.id}
                        onClick={() => setSelectedModelId(model.id)}
                        className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all ${selectedModelId === model.id ? 'border-indigo-600 ring-2 ring-indigo-600/20' : 'border-transparent hover:border-gray-300'}`}
                      >
                        <img src={model.processedUrl || model.url} alt={model.name} className="w-full h-full object-cover" />
                        {selectedModelId === model.id && (
                          <div className="absolute top-1 right-1 bg-indigo-600 rounded-full p-0.5">
                            <CheckCircle2 className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Garment or Hairstyle Selection */}
                {studioMode === 'clothing' ? (
                  <section>
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">2. Select Garment</h2>
                    <div className="grid grid-cols-3 gap-3">
                      {garments.map(garment => (
                        <button
                          key={garment.id}
                          onClick={() => {
                            setSelectedGarmentId(garment.id);
                            setSelectedColor(null);
                            setColoredGarmentUrl(null);
                          }}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 bg-white transition-all ${selectedGarmentId === garment.id ? 'border-indigo-600 ring-2 ring-indigo-600/20' : 'border-gray-200 hover:border-gray-300'}`}
                        >
                          <img 
                            src={selectedGarmentId === garment.id && coloredGarmentUrl ? coloredGarmentUrl : garment.url} 
                            alt={garment.name} 
                            className={`w-full h-full object-contain p-2 ${selectedGarmentId === garment.id && isGeneratingColor ? 'opacity-30' : ''}`} 
                          />
                          {selectedGarmentId === garment.id && isGeneratingColor && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                            </div>
                          )}
                          {selectedGarmentId === garment.id && !isGeneratingColor && (
                            <div className="absolute top-1 right-1 bg-indigo-600 rounded-full p-0.5">
                              <CheckCircle2 className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>

                    {selectedGarmentId && (
                      <div className="mt-4 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex justify-between items-center">
                          Color Variation
                          <span className="text-indigo-500 flex items-center gap-1 normal-case"><Coins className="w-3 h-3"/> 1 credit</span>
                        </h3>
                        <div className="flex flex-wrap gap-2 items-center">
                          <button 
                            onClick={() => { setSelectedColor(null); setColoredGarmentUrl(null); }} 
                            className={`text-xs px-2 py-1.5 rounded border transition-colors ${!selectedColor ? 'bg-gray-100 border-gray-300 font-medium text-gray-800' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-600'}`}
                          >
                            Original
                          </button>
                          <div className="w-px h-4 bg-gray-300 mx-1"></div>
                          {PRESET_COLORS.map(c => (
                            <button
                              key={c.name}
                              onClick={() => handleColorSelect(c.name)}
                              className={`w-6 h-6 rounded-full border shadow-sm transition-transform hover:scale-110 ${selectedColor === c.name ? 'ring-2 ring-offset-1 ring-indigo-600 border-transparent' : 'border-gray-200'}`}
                              style={{ backgroundColor: c.value }}
                              title={c.name}
                            />
                          ))}
                          <div className="w-px h-4 bg-gray-300 mx-1"></div>
                          <div className="flex items-center gap-1">
                            <input 
                              type="color" 
                              value={customColor}
                              onChange={(e) => setCustomColor(e.target.value)}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                              title="Custom Color"
                            />
                            <button 
                              onClick={() => handleColorSelect(customColor)} 
                              disabled={isGeneratingColor || credits < 1}
                              className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded font-medium text-gray-700 disabled:opacity-50 flex items-center gap-1"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                ) : (
                  <section>
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">2. Select Hairstyle</h2>
                    <div className="grid grid-cols-3 gap-3">
                      {hairstyles.map(hairstyle => (
                        <button
                          key={hairstyle.id}
                          onClick={() => setSelectedHairstyleId(hairstyle.id)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 bg-white transition-all ${selectedHairstyleId === hairstyle.id ? 'border-indigo-600 ring-2 ring-indigo-600/20' : 'border-gray-200 hover:border-gray-300'}`}
                        >
                          <img 
                            src={hairstyle.url} 
                            alt={hairstyle.name} 
                            className="w-full h-full object-cover" 
                          />
                          {selectedHairstyleId === hairstyle.id && (
                            <div className="absolute top-1 right-1 bg-indigo-600 rounded-full p-0.5">
                              <CheckCircle2 className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Pose Selection */}
                <section>
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">3. Select Poses</h2>
                    <span className="text-xs text-gray-400">{selectedPoses.length} selected</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {POSE_OPTIONS.map((poseOption) => {
                      const isSelected = selectedPoses.includes(poseOption.instruction);
                      return (
                        <button
                          key={poseOption.id}
                          onClick={() => togglePose(poseOption.instruction)}
                          className={`relative group flex flex-col items-center text-left rounded-lg border transition-all overflow-hidden ${isSelected ? 'border-indigo-600 ring-2 ring-indigo-600 ring-opacity-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                          title={poseOption.instruction}
                        >
                          <div className="w-full aspect-[3/4] bg-gray-100 relative">
                            <img src={poseOption.thumbnail} alt={poseOption.label} className="w-full h-full object-cover" />
                            {isSelected && (
                              <div className="absolute top-2 right-2 bg-white rounded-full shadow-sm">
                                <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                              </div>
                            )}
                          </div>
                          <div className={`w-full p-2 text-center ${isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-white text-gray-700'}`}>
                            <span className="text-xs">{poseOption.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>

              {/* Right Column: Preview/Result */}
              <div className="w-full lg:w-2/3 bg-gray-100 rounded-2xl border border-gray-200 flex flex-col items-center justify-center relative overflow-hidden min-h-[500px]">
                {isGenerating ? (
                  <div className="flex flex-col items-center justify-center w-full max-w-sm mx-auto p-8">
                    <div className="relative w-20 h-20 mb-8">
                      <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Wand2 className="w-8 h-8 text-indigo-600 animate-pulse" />
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-8 text-center">{loadingMessage}</h3>
                    
                    {generationStep !== 'uploading' && (
                      <div className="w-full space-y-5">
                        {[
                          { id: 'preparing', label: 'Preparing assets' },
                          { id: 'applying', label: 'Applying garment' },
                          { id: 'posing', label: 'Generating poses' },
                          { id: 'finalizing', label: 'Finalizing images' }
                        ].map((step, index) => {
                          const stepOrder = ['preparing', 'applying', 'posing', 'finalizing'];
                          const currentIndex = stepOrder.indexOf(generationStep as string);
                          const isActive = generationStep === step.id;
                          const isPast = currentIndex > index;
                          
                          return (
                            <div key={step.id} className="flex items-center gap-4">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                                isPast ? 'bg-emerald-500 text-white scale-100' : 
                                isActive ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 scale-110' : 
                                'bg-gray-200 text-gray-500 scale-100'
                              }`}>
                                {isPast ? <CheckCircle2 className="w-5 h-5" /> : index + 1}
                              </div>
                              <span className={`text-sm font-medium transition-colors duration-300 ${
                                isActive ? 'text-indigo-600' : 
                                isPast ? 'text-gray-900' : 
                                'text-gray-400'
                              }`}>
                                {step.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : generatedImages.length > 0 ? (
                  <div className="absolute inset-0 overflow-y-auto p-6">
                    <div className={`grid gap-6 ${generatedImages.length === 1 ? 'grid-cols-1 max-w-md mx-auto' : 'grid-cols-1 md:grid-cols-2'}`}>
                      {generatedImages.map((img, idx) => (
                        <div key={idx} className="relative group rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                          <img src={img.url} alt={`Pose: ${img.pose}`} className="w-full h-auto object-contain" />
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                            <p className="text-white text-sm font-medium">{img.pose}</p>
                          </div>
                          <button 
                            onClick={() => downloadImage(img.url, img.pose)}
                            className="absolute top-3 right-3 bg-white/90 backdrop-blur shadow-sm hover:bg-white text-gray-700 p-2.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100 flex items-center justify-center"
                            title="Download Image"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-gray-400">
                    <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg font-medium text-gray-500">Ready to Generate</p>
                    <p className="text-sm mt-1">Select a model, garment, and poses, then click Generate.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'models' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <p className="text-gray-600">Manage your studio models. Upload raw photos and our AI will process them for catalog use.</p>
                <label className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-medium hover:bg-gray-50 cursor-pointer transition-colors">
                  <UploadCloud className="w-4 h-4" />
                  Upload Model
                  <input type="file" className="hidden" accept="image/*" onChange={handleModelUpload} />
                </label>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {models.map(model => (
                  <div key={model.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="aspect-[3/4] bg-gray-100 relative">
                      <img src={model.processedUrl || model.url} alt={model.name} className="w-full h-full object-cover" />
                      {!model.processedUrl && (
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center backdrop-blur-sm">
                          <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="font-medium text-sm truncate">{model.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{model.processedUrl ? 'Processed' : 'Processing...'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'garments' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <p className="text-gray-600">Manage your product catalog. Upload flat-lay or ghost mannequin images.</p>
                <label className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-medium hover:bg-gray-50 cursor-pointer transition-colors">
                  <UploadCloud className="w-4 h-4" />
                  Upload Garment
                  <input type="file" className="hidden" accept="image/*" onChange={handleGarmentUpload} />
                </label>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {garments.map(garment => (
                  <div key={garment.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="aspect-square bg-gray-50 p-4">
                      <img src={garment.url} alt={garment.name} className="w-full h-full object-contain mix-blend-multiply" />
                    </div>
                    <div className="p-3 border-t border-gray-100">
                      <p className="font-medium text-sm truncate">{garment.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'hairstyles' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <p className="text-gray-600">Manage your hairstyles catalog. Upload reference images for haircuts and colors.</p>
                <label className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-medium hover:bg-gray-50 cursor-pointer transition-colors">
                  <UploadCloud className="w-4 h-4" />
                  Upload Hairstyle
                  <input type="file" className="hidden" accept="image/*" onChange={handleHairstyleUpload} />
                </label>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {hairstyles.map(hairstyle => (
                  <div key={hairstyle.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="aspect-square bg-gray-50 p-0">
                      <img src={hairstyle.url} alt={hairstyle.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-3 border-t border-gray-100">
                      <p className="font-medium text-sm truncate">{hairstyle.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <p className="text-gray-600">View and download your previously generated images.</p>
              </div>
              
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <History className="w-16 h-16 mb-4 opacity-30" />
                  <p className="text-lg font-medium text-gray-500">No history yet</p>
                  <p className="text-sm mt-1">Images you generate will appear here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {history.map(item => (
                    <div key={item.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm group relative">
                      <div className="aspect-[3/4] bg-gray-100 relative">
                        <img src={item.url} alt={item.pose} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <button 
                            onClick={() => downloadImage(item.url, item.pose)}
                            className="bg-white text-gray-900 p-2 rounded-full hover:bg-gray-100 transition-colors shadow-sm"
                            title="Download"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="font-medium text-sm truncate" title={item.pose}>{item.pose}</p>
                        <p className="text-xs text-gray-500 mt-1">{new Date(item.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;