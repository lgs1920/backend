export class Controller {

    // Relative path from api to studio and vice versa
    // In production we are in dist... so ../.. instead of ..
    BACKEND= `../${process.env.NODE_ENV === 'production' ? '../' : ''}backend/`
    STUDIO = `../${process.env.NODE_ENV === 'production' ? '../' : ''}studio/`
    ASSETS = 'assets/'

    constructor() {
    }

    setStudioDirectory = () => {
        return process.env.NODE_ENV==='production'?`${this.STUDIO}dist`:this.STUDIO
    }

    setBackendDirectory= () => {
        return process.env.NODE_ENV==='production'?`${this.BACKEND}dist`:this.BACKEND
    }


    setStudioFilePath = (name) => {
        return `${this.setStudioDirectory()}${process.env.NODE_ENV === 'production' ? '/' : 'public/'}${name}`
    }
    setBackendFilePath = (name) => {
        return `${this.setBackendDirectory()}${process.env.NODE_ENV === 'production' ? '/' : '/'}${name}`
    }

    setPublicDirectoryPath =(name) => {
        return this.setStudioFilePath(name)+'/'
    }

    setAssetFilePath= (name) => {
        return this.setStudioFilePath(`${this.ASSETS}${name}`)
    }

    setAssetDirectoryPath= (name) => {
        return this.setAssetFilePath(name)+'/'
    }
}