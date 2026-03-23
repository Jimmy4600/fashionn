/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const fileToPart = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
    const { mimeType, data } = dataUrlToParts(dataUrl);
    return { inlineData: { mimeType, data } };
};

const dataUrlToParts = (dataUrl: string) => {
    const arr = dataUrl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");
    return { mimeType: mimeMatch[1], data: arr[1] };
}

const dataUrlToPart = (dataUrl: string) => {
    const { mimeType, data } = dataUrlToParts(dataUrl);
    return { inlineData: { mimeType, data } };
}

const handleApiResponse = (response: GenerateContentResponse): string => {
    if (response.promptFeedback?.blockReason) {
        const { blockReason, blockReasonMessage } = response.promptFeedback;
        const errorMessage = `Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ''}`;
        throw new Error(errorMessage);
    }

    // Find the first image part in any candidate
    for (const candidate of response.candidates ?? []) {
        const imagePart = candidate.content?.parts?.find(part => part.inlineData);
        if (imagePart?.inlineData) {
            const { mimeType, data } = imagePart.inlineData;
            return `data:${mimeType};base64,${data}`;
        }
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        const errorMessage = `Image generation stopped unexpectedly. Reason: ${finishReason}. This often relates to safety settings.`;
        throw new Error(errorMessage);
    }
    const textFeedback = response.text?.trim();
    const errorMessage = `The AI model did not return an image. ` + (textFeedback ? `The model responded with text: "${textFeedback}"` : "This can happen due to safety filters or if the request is too complex. Please try a different image.");
    throw new Error(errorMessage);
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY! });
const model = 'gemini-2.5-flash-image';

export const generateModelImage = async (userImage: File): Promise<string> => {
    const userImagePart = await fileToPart(userImage);
    const prompt = "Edit this image to transform the person into a professional fashion model. Change the background to a clean, neutral light gray studio backdrop. Make the person stand in a relaxed, professional model pose. Keep the person's face and identity exactly the same.";
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [userImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const generateVirtualTryOnImage = async (modelImageUrl: string, garmentImage: File): Promise<string> => {
    const modelImagePart = dataUrlToPart(modelImageUrl);
    const garmentImagePart = await fileToPart(garmentImage);
    
    // Step 1: Use the text model to get a highly detailed description of the garment
    const describeResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [
            garmentImagePart,
            { text: "Describe the main clothing/outfit in this image in extreme detail. Focus on the type of garment, color, material, pattern, collar, sleeves, and fit. Do not describe the person or background. Just describe the clothes. Keep it concise but highly descriptive (e.g., 'A thick black puffer jacket worn open over a white and black horizontally striped crew-neck t-shirt')." }
        ] }
    });
    const garmentDescription = describeResponse.text?.trim() || "new clothes";

    // Step 2: Use the image model to edit the original image using the text description
    const prompt = `Edit this image. Change the person's clothing to exactly match this description: "${garmentDescription}". Keep the person's face, identity, body shape, pose, and the background completely unchanged. Only change the clothes.`;
    
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [
            modelImagePart, 
            { text: prompt }
        ] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const generateHairstyleTryOnImage = async (modelImageUrl: string, hairstyleImage: File): Promise<string> => {
    const modelImagePart = dataUrlToPart(modelImageUrl);
    const hairstyleImagePart = await fileToPart(hairstyleImage);
    
    // Step 1: Use the text model to get a highly detailed description of the hairstyle
    const describeResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [
            hairstyleImagePart,
            { text: "Describe the hairstyle in this image in extreme detail. Focus on the cut, length, texture, color, volume, and styling. Do not describe the person's face or clothing. Just describe the hair. Keep it concise but highly descriptive (e.g., 'Short textured pixie cut with platinum blonde color and swept bangs')." }
        ] }
    });
    const hairDescription = describeResponse.text?.trim() || "new hairstyle";

    // Step 2: Use the image model to edit the original image using the text description
    const prompt = `Edit this image. Change the person's hair to exactly match this description: "${hairDescription}". Keep the person's face, identity, body shape, clothing, pose, and the background completely unchanged. Only change the hair.`;
    
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [
            modelImagePart, 
            { text: prompt }
        ] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const generateGarmentColorVariation = async (garmentImage: File, colorInstruction: string): Promise<string> => {
    const garmentImagePart = await fileToPart(garmentImage);
    const prompt = `You are an expert fashion photo editor. Change the color of the main clothing item in this image to ${colorInstruction}. Preserve the background, lighting, fabric texture, and shape perfectly. Return ONLY the final image.`;
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [garmentImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const generatePoseVariation = async (tryOnImageUrl: string, poseInstruction: string): Promise<string> => {
    const tryOnImagePart = dataUrlToPart(tryOnImageUrl);
    const prompt = `You are an expert fashion photographer AI. Take this image and regenerate it from a different perspective. The person, clothing, and background style must remain identical. The new perspective should be: "${poseInstruction}". Return ONLY the final image.`;
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [tryOnImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};